import assert from "node:assert/strict"
import { createHash } from "node:crypto"

type RuntimeObject = Record<string, any>
type DiagnosticOptions = {
  pipelineClass: { prototype: RuntimeObject }
  registeredPipelineClass: unknown
  targetPhase: string
  targetNode: string
  targetConnection: string
  rootConnection: string
  onSnapshot: (report: RuntimeObject) => void
}
type ObservedSolver = { solver: RuntimeObject; record: RuntimeObject; kind: string }

/** Capture native failure inputs without replaying any solver or requesting output. */
export function createHighDensityFailureDiagnostics(options: DiagnosticOptions): {
  onSolverStarted: (event: RuntimeObject, phase: string | undefined) => void
  finish: () => RuntimeObject | null
} {
  assert.equal(options.pipelineClass, options.registeredPipelineClass)
  let report: RuntimeObject | null = null
  let pipeline: RuntimeObject | undefined
  let disabled = false
  const restorations: (() => void)[] = []
  const observed = new Map<RuntimeObject, ObservedSolver>()
  const blobs: Record<string, unknown> = {}
  let serializedBytes = 0
  let observationMs = 0

  // Read data properties only. Maps/Sets retain their contents, and callbacks are
  // identified explicitly rather than silently lost by JSON.stringify.
  const copyData = (value: any, depth = 0): any => {
    assert(depth < 80, "Diagnostic input exceeded the nesting limit")
    if (value === undefined) return { $undefined: true }
    if (typeof value === "function") return { $callback: value.name || "anonymous", executable: false }
    if (typeof value === "number" && !Number.isFinite(value)) return { $number: String(value) }
    if (value === null || typeof value !== "object") return value
    if (value instanceof Map) return { $map: [...value.entries()].map(([key, item]) => [copyData(key, depth + 1), copyData(item, depth + 1)]) }
    if (value instanceof Set) return { $set: [...value.values()].map(item => copyData(item, depth + 1)) }
    if (Array.isArray(value)) return value.map(item => copyData(item, depth + 1))
    assert(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, "Unexpected class in diagnostic data")
    const entries = Object.entries(Object.getOwnPropertyDescriptors(value))
    assert(entries.every(([, descriptor]) => "value" in descriptor), "Diagnostic data contained an accessor")
    return Object.fromEntries(entries.filter(([, descriptor]) => descriptor.enumerable).map(([key, descriptor]) => [key, copyData(descriptor.value, depth + 1)]))
  }
  const storeData = (value: unknown): RuntimeObject => {
    const data = copyData(value)
    const json = JSON.stringify(data)
    const sha256 = createHash("sha256").update(json).digest("hex")
    if (!Object.hasOwn(blobs, sha256)) {
      serializedBytes += Buffer.byteLength(json)
      assert(serializedBytes <= 24 * 1024 * 1024, "Diagnostic native inputs exceeded 24 MiB; capture invalid")
      blobs[sha256] = data
    }
    return { $blob: sha256 }
  }
  const parameterSnapshot = (params: RuntimeObject): RuntimeObject => {
    assert(params && typeof params === "object", "Missing native constructor parameters")
    const result: RuntimeObject = {}
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(params))) {
      assert("value" in descriptor, `Unexpected parameter accessor ${key}`)
      const value = descriptor.value
      if (key === "connMap" && value !== undefined && value !== null) {
        assert(value.netMap && value.idToNetMap, "Missing native connectivity maps")
        result[key] = { className: value.constructor.name, netMap: storeData(value.netMap), idToNetMap: storeData(value.idToNetMap) }
      } else if (value !== null && typeof value === "object") result[key] = storeData(value)
      else result[key] = copyData(value)
    }
    return result
  }
  const stateSnapshot = (solver: RuntimeObject): RuntimeObject => ({
    className: solver.constructor.name, iterations: solver.iterations,
    MAX_ITERATIONS: solver.MAX_ITERATIONS, solved: solver.solved,
    failed: solver.failed, error: solver.error,
    growthAttempts: solver.growthAttempts ?? null, scaleFactor: solver.scaleFactor ?? null,
    maxGrowthAttempts: solver.maxGrowthAttempts ?? null,
    stats: solver.stats ? Object.fromEntries(Object.entries(solver.stats).filter(([, value]) => value === null || ["number", "string", "boolean"].includes(typeof value))) : null,
  })
  const failureTree = (root: RuntimeObject): RuntimeObject[] => {
    const rows: RuntimeObject[] = []
    const visited = new Map<RuntimeObject, number>()
    let candidateSummaryCount = 0
    const visit = (solver: RuntimeObject, parent: number | null, relation: string, hyperParameters?: unknown): void => {
      if (!solver) return
      if (visited.has(solver)) { rows.push({ parent, relation, solverRef: visited.get(solver) }); return }
      assert(visited.size < 384, "Native coordinator tree exceeded 384 solver instances; capture invalid")
      const id = visited.size
      visited.set(solver, id)
      const row: RuntimeObject = { id, parent, relation, ...stateSnapshot(solver) }
      if (solver.constructorParams) row.parameters = parameterSnapshot(solver.constructorParams)
      if (solver.nodeSolveMetadataById instanceof Map) row.nodeSolveMetadata = storeData(solver.nodeSolveMetadataById)
      if (hyperParameters !== undefined) row.hyperParameters = copyData(hyperParameters)
      rows.push(row)
      if (Array.isArray(solver.supervisedSolvers)) {
        candidateSummaryCount += solver.supervisedSolvers.length
        assert(candidateSummaryCount <= 8192, "Native portfolio exceeded 8192 candidate summaries; capture invalid")
        // A candidate can retain hundreds of internal search solvers. Capture
        // every portfolio candidate's outcome, without walking those searches.
        row.portfolioCandidates = solver.supervisedSolvers.map((candidate: RuntimeObject) => ({
          ...stateSnapshot(candidate.solver), hyperParameters: copyData(candidate.hyperParameters),
          internalSearchTreeCaptured: false,
        }))
        row.activeCandidateIndex = solver.supervisedSolvers.findIndex((candidate: RuntimeObject) => candidate.solver === solver.activeSubSolver)
        return
      }
      for (const name of ["highDensitySolver", "activeSubSolver", "forceImproveSolver", "repairSolver", "winningSolver"]) if (solver[name]) visit(solver[name], id, name)
      for (const name of ["failedSolvers", "failedSubSolvers"]) if (Array.isArray(solver[name])) for (const child of solver[name]) visit(child, id, name)
    }
    visit(root, null, "root")
    return rows
  }
  const capture = (action: () => void): void => {
    if (disabled) return
    const started = performance.now()
    try { action() }
    catch (error) {
      disabled = true
      report!.captureErrors.push(String(error))
    } finally { observationMs += performance.now() - started }
  }
  const writeSnapshot = (): void => {
    assert(report)
    report.serializedInputBytes = serializedBytes
    report.observationMs = observationMs
    report.captureValid = !disabled
    options.onSnapshot(report)
  }
  const captureConnections = (): void => {
    if (report!.connections || !pipeline!.srjWithPointPairs) return
    const derived = pipeline!.srjWithPointPairs.connections.filter((connection: RuntimeObject) => connection.name === options.targetConnection)
    const stored = pipeline!.netToPointPairsSolver.newConnections.filter((connection: RuntimeObject) => connection.name === options.targetConnection)
    assert.equal(derived.length, 1, "Expected exactly one native point pair")
    assert.equal(stored.length, 1, "Expected exactly one stored point pair")
    assert.deepEqual(derived[0], stored[0], "Stored native point-pair copies disagree")
    const roots = pipeline!.originalSrj.connections.filter((connection: RuntimeObject) => connection.name === options.rootConnection)
    assert.equal(roots.length, 1, "Missing original phase root connection")
    report!.connections = { original: copyData(roots[0]), pointPair: copyData(derived[0]), pointPairStageOriginal: copyData(pipeline!.netToPointPairsSolver.ogSrj.connections.filter((connection: RuntimeObject) => connection.name === options.rootConnection)) }
  }
  const observeActive = (): ObservedSolver[] => {
    const hd = pipeline!.highDensityRouteSolver
    if (!hd || hd.activeNode?.capacityMeshNodeId !== options.targetNode) return []
    captureConnections()
    const active: ObservedSolver[] = []
    for (const [field, kind] of [["activeB01Solver", "b01"], ["activeRegularSolver", "regular"], ["activeFallbackSolver", "regional"]]) {
      const solver = hd[field!]
      if (!solver) continue
      let entry = observed.get(solver)
      if (!entry) {
        assert(observed.size < 24, "Target region created more than 24 solver instances; capture invalid")
        const record: RuntimeObject = { id: observed.size, kind, initial: stateSnapshot(solver), node: storeData(hd.activeNode) }
        if (kind === "b01") {
          const params = solver.getConstructorParams()
          assert(Array.isArray(params) && params.length === 1)
          record.parameters = parameterSnapshot(params[0])
          record.MAX_RIPS = solver.MAX_RIPS
        } else if (kind === "regional") {
          // These collections are cleared/replaced by the parent on failure and
          // promotion. Snapshot each distinct regional instance before stepping.
          record.parameters = parameterSnapshot(solver.params)
          record.fixedRouteSections = storeData(hd.activeFallbackFixedRouteSections)
          record.fixedObstacleRoutes = storeData(hd.activeFallbackFixedObstacleRoutes)
          record.promotedConnectionNames = storeData(hd.activeFallbackPromotedFixedRouteConnectionNames)
          record.reason = hd.activeFallbackReason
          record.fixedRouteReplacements = storeData(hd.fixedRouteReplacements)
          record.removedFixedRouteConnectionNames = storeData(hd.removedFixedRouteConnectionNames)
        } else {
          const fields = ["viaDiameter", "traceWidth", "obstacleMargin", "effort", "layerCount", "obstacles", "boardGeometry", "connMap", "nodePfById", "preserveTerminalPcbPortIds", "captureSearchDebug", "priorityDagOptions"]
          record.parameters = parameterSnapshot(Object.fromEntries(fields.filter(key => hd[field!][key] !== undefined).map(key => [key, solver[key]])))
        }
        entry = { solver, record, kind: kind! }
        observed.set(solver, entry)
        report!.attempts.push(record)
        writeSnapshot()
      }
      if (kind === "b01") entry.record.lastBeforeStep = { ...stateSnapshot(solver), activeConnection: copyData(solver.activeConnection), openSetLength: solver.openSet.length, unsolvedConnectionCount: solver.unsolvedConnections === undefined ? null : solver.unsolvedConnections.length, gridStats: copyData(solver.gridStats), totalRipEvents: solver.totalRipEvents }
      active.push(entry)
    }
    return active
  }
  const observeAfter = (before: ObservedSolver[]): void => {
    for (const { solver, record } of before) {
      if (!record.final && (solver.failed || solver.solved)) {
        record.final = stateSnapshot(solver)
        record.candidates = failureTree(solver)
        writeSnapshot()
      }
    }
    observeActive()
  }
  const installMethod = (object: RuntimeObject, original: (...args: unknown[]) => unknown): void => {
    const descriptor = Object.getOwnPropertyDescriptor(object, "step")
    const wrapper = function (this: RuntimeObject, ...args: unknown[]): unknown {
      let before: ObservedSolver[] = []
      capture(() => { before = observeActive() })
      try { return Reflect.apply(original, this, args) }
      finally { capture(() => observeAfter(before)) }
    }
    object.step = wrapper
    restorations.push(() => {
      if (object.step !== wrapper) return
      if (descriptor) Object.defineProperty(object, "step", descriptor)
      else delete object.step
    })
  }
  return {
    onSolverStarted(event: RuntimeObject, phase: string | undefined): void {
      if (phase !== options.targetPhase || event.solverName !== "AutoroutingPipelineSolver9_PreloadedTraceGraph") return
      assert.equal(report, null, "Target phase started twice")
      const input = event.solverParams?.input
      assert(input && Array.isArray(input.connections))
      report = { instrumentation: "native instance before/after reference capture", phase, targetNode: options.targetNode, targetConnection: options.targetConnection, rootConnection: options.rootConnection, attempts: [], captureErrors: [], blobs }
      const prototype = options.pipelineClass.prototype
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "step")
      const original = prototype.step
      assert.equal(typeof original, "function")
      const bootstrap = function (this: RuntimeObject, ...args: unknown[]): unknown {
        if (prototype.step === bootstrap) {
          if (descriptor) Object.defineProperty(prototype, "step", descriptor)
          else delete prototype.step
        }
        capture(() => {
          assert.equal(pipeline, undefined, "Unexpected second pipeline instance")
          assert.equal(this.originalSrj.connections, input.connections)
          assert.equal(this.originalSrj.traces, input.traces)
          pipeline = this
          installMethod(this, original)
        })
        return Reflect.apply(disabled ? original : this.step, this, args)
      }
      prototype.step = bootstrap
      restorations.push(() => {
        if (prototype.step !== bootstrap) return
        if (descriptor) Object.defineProperty(prototype, "step", descriptor)
        else delete prototype.step
      })
    },
    finish(): RuntimeObject | null {
      if (report) capture(() => {
        if (pipeline) {
          report!.pipelineFinal = stateSnapshot(pipeline)
          if (pipeline.highDensityRouteSolver) report!.highDensityFinal = stateSnapshot(pipeline.highDensityRouteSolver)
          captureConnections()
        }
        for (const { solver, record } of observed.values()) if (!record.final) {
          record.final = stateSnapshot(solver)
          record.candidates = failureTree(solver)
        }
      })
      for (const restore of restorations.reverse()) restore()
      if (report) {
        report.captureValid = !disabled && Boolean(report.connections) && report.attempts.some((attempt: RuntimeObject) => attempt.kind === "regional" && attempt.final?.failed)
        report.observationMs = observationMs
        report.serializedInputBytes = serializedBytes
      }
      return report
    },
  }
}
