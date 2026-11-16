import assert from "node:assert/strict"
import { createHash } from "node:crypto"

type RuntimeObject = Record<string, any>
type DiagnosticOptions = {
  pipelineClass: { prototype: RuntimeObject }
  registeredPipelineClass: unknown
  targetNodeId: string
  targetPhase: string
  onSnapshot: (report: RuntimeObject, event: string) => void
}
type WitnessGlobal = typeof globalThis & {
  __tscircuitHdWitness?: (event: RuntimeObject) => void
}

const MAX_REPORT_BYTES = 150_000
const TARGET_PRELOAD_NAMES = new Set([
  "source_net_20_fixed_16_50",
  "source_net_20_fixed_16_51",
  "source_net_20_fixed_16_52",
])

function solverSummary(solver: RuntimeObject): RuntimeObject {
  const stats = solver.stats ?? {}
  return {
    name: solver.getSolverName(), iterations: solver.iterations,
    maxIterations: solver.MAX_ITERATIONS, solved: solver.solved,
    failed: solver.failed, error: solver.error,
    stats: Object.fromEntries(Object.entries(stats).filter(([, value]) =>
      typeof value === "number" || typeof value === "boolean")),
    statsSummary: valueSummary(stats),
  }
}

function valueSummary(value: unknown): RuntimeObject {
  const serialized = JSON.stringify(value)
  return {
    bytes: Buffer.byteLength(serialized),
    sha256: createHash("sha256").update(serialized).digest("hex"),
  }
}

function nodeSummary(node: RuntimeObject): RuntimeObject {
  assert(node.portPoints.length <= 32, "Target node exceeds witness port budget")
  const fields = ["capacityMeshNodeId", "center", "width", "height", "availableZ", "portPoints"]
  return {
    ...structuredClone(Object.fromEntries(fields.filter(key => node[key] !== undefined)
      .map(key => [key, node[key]]))),
    portPointCount: node.portPoints.length, originalNode: valueSummary(node),
  }
}

function cloneRoute(route: RuntimeObject): RuntimeObject {
  assert(route.route.length <= 2048, "Scoped route exceeds witness point budget")
  const fields = ["connectionName", "rootConnectionName", "isFixed", "isThroughObstacle",
    "preloadedTraceIndex", "preloadedRouteIndex", "preloadedRoutePositionStart",
    "preloadedRoutePositionEnd", "traceThickness", "viaDiameter", "route", "vias"]
  return structuredClone(Object.fromEntries(fields.filter(key => route[key] !== undefined)
    .map(key => [key, route[key]])))
}

function canonicalIdentity(connMap: RuntimeObject, route: RuntimeObject): RuntimeObject {
  const ids = [route.connectionName, route.rootConnectionName].filter(id => typeof id === "string")
  return {
    connectionName: route.connectionName, rootConnectionName: route.rootConnectionName,
    resolvedIds: ids.map(id => ({ id, net: connMap.getNetConnectedToId(id),
      isCanonicalNetKey: Object.hasOwn(connMap.netMap, id) })),
  }
}

function preloadMatches(route: RuntimeObject): boolean {
  if (TARGET_PRELOAD_NAMES.has(route.connectionName)) return true
  if (route.preloadedTraceIndex !== 16) return false
  return Number.isFinite(route.preloadedRoutePositionStart) &&
    Number.isFinite(route.preloadedRoutePositionEnd) &&
    route.preloadedRoutePositionStart <= 57 && route.preloadedRoutePositionEnd >= 53
}

function sameObstacle(left: RuntimeObject, right: RuntimeObject): boolean {
  if (left === right) return true
  if (left.obstacleId !== undefined && left.obstacleId === right.obstacleId) return true
  return left.center?.x === right.center?.x && left.center?.y === right.center?.y &&
    left.width === right.width && left.height === right.height &&
    JSON.stringify(left.layers) === JSON.stringify(right.layers) &&
    JSON.stringify(left.connectedTo) === JSON.stringify(right.connectedTo)
}

function searchInputs(regional: RuntimeObject, obstacle: RuntimeObject, connectionName: string,
  actualRouteInputs: WeakMap<object, Map<string, RuntimeObject>>): RuntimeObject[] {
  const chain: RuntimeObject[] = []
  let solver: RuntimeObject | null = regional.highDensitySolver
  for (let depth = 0; solver && depth < 8; depth++, solver = solver.activeSubSolver) {
    const row: RuntimeObject = { ...solverSummary(solver),
      relevantFieldNames: Object.keys(solver).filter(key => /via|layer|obstacle|clearance|bounds/i.test(key)) }
    if (actualRouteInputs.has(solver)) {
      const records = actualRouteInputs.get(solver)!
      row.actualSingleRouteInputCount = records.size
      row.actualSingleRouteInputsSummary = valueSummary([...records])
      row.actualSingleRouteInputs = records.has(connectionName) ? [records.get(connectionName)] : []
    }
    if (Array.isArray(solver.supervisedSolvers) && typeof solver.candidateValidator === "function") {
      const candidate = solver.activeSubSolver
      const index = solver.supervisedSolvers.findIndex((item: RuntimeObject) => item.solver === candidate)
      row.validatingCandidate = index < 0 ? { identity: "unavailable" } : {
        identity: "exact active supervised instance; assigned before candidateValidator",
        index, name: candidate.getSolverName(), iterations: candidate.iterations,
        solved: candidate.solved, failed: candidate.failed,
        actualRouteInputsForSameInstance: actualRouteInputs.has(candidate),
        actualRouteInputConnectionNames: [...(actualRouteInputs.get(candidate)?.keys() ?? [])],
      }
    }
    const sources = [["solver", solver], ["constructorParams", solver.constructorParams],
      ["params", solver.params], ["obstacleChecker", solver.obstacleChecker]] as const
    row.inputs = sources.filter(([, source]) => Boolean(source)).map(([label, source]) => {
      const values: RuntimeObject = { source: label }
      for (const key of ["layerCount", "availableZ", "viaDiameter", "viaToPadClearance", "viaCopperClearance",
        "allowBlindAndBuriedVias", "obstacleMargin", "minClearance", "traceWidth", "traceThickness",
        "scaleFactor", "priorityCoordinateScale", "bounds", "boundsSize", "boundsMinX", "boundsMaxX", "boundsMinY", "boundsMaxY"])
        if (source[key] !== undefined) values[key] = structuredClone(source[key])
      if (source.nodeWithPortPoints) values.node = nodeSummary(source.nodeWithPortPoints)
      for (const key of ["obstacles", "boardObstacles"]) {
        if (!Array.isArray(source[key])) continue
        values[`${key}Count`] = source[key].length
        values[`${key}Summary`] = valueSummary(source[key])
        values[`${key}MatchingWitnessCount`] = source[key].filter((item: RuntimeObject) => sameObstacle(item, obstacle)).length
      }
      return values
    })
    chain.push(row)
  }
  return chain
}

function nearbyBoardObstacles(regional: RuntimeObject, event: RuntimeObject): RuntimeObject {
  const source = regional.params.boardObstacles ? "boardObstacles" : "obstacles"
  const obstacles = regional.params[source]
  assert(Array.isArray(obstacles), "Regional board obstacles unavailable")
  const node = regional.params.nodeWithPortPoints
  const margin = event.route.viaDiameter / 2 + event.viaToPadClearance
  const selected = obstacles.filter((obstacle: RuntimeObject) => {
    assert(obstacle.center && Number.isFinite(obstacle.width) && Number.isFinite(obstacle.height))
    // Half-diagonal conservatively covers rectangles at every rotation.
    const radius = Math.hypot(obstacle.width, obstacle.height) / 2 + margin
    return Math.abs(obstacle.center.x - node.center.x) <= node.width / 2 + radius &&
      Math.abs(obstacle.center.y - node.center.y) <= node.height / 2 + radius
  })
  assert(selected.length <= 64, "Nearby board obstacles exceed witness budget")
  return {
    source, sourceCount: obstacles.length, sourceSummary: valueSummary(obstacles),
    selection: "Complete conservative overlap with original node expanded by via radius plus pad clearance",
    margin, selectedCount: selected.length,
    obstacles: selected.map((obstacle: RuntimeObject) => ({
      obstacle: structuredClone(obstacle),
      identities: obstacle.connectedTo.map((id: string) => ({ id,
        net: event.connMap.getNetConnectedToId(id), isCanonicalNetKey: Object.hasOwn(event.connMap.netMap, id) })),
    })),
  }
}

function coarseTargetContext(pipeline: RuntimeObject, targetNodeId: string): RuntimeObject {
  try {
    const pathing = pipeline.portPointPathingSolver
    if (typeof pathing?.getSolvedTinySolver !== "function") return { available: false, reason: "Solved Tiny accessor unavailable" }
    const tiny = pathing.getSolvedTinySolver()
    const { topology, problem, state } = tiny
    const regionIds = topology.regionMetadata?.flatMap((metadata: RuntimeObject, index: number) =>
      metadata?.capacityMeshNodeId === targetNodeId ? [index] : []) ?? []
    if (regionIds.length !== 1) return { available: false, reason: "Target Tiny region is not unique", matchingRegionCount: regionIds.length }
    const regionId = regionIds[0]
    const segments = state.regionSegments[regionId]
    assert(Array.isArray(segments) && segments.length <= 16, "Target Tiny segment budget exceeded")
    const initialAssignments = problem.initialAssignments?.filter((entry: RuntimeObject) => entry.regionId === regionId) ?? []
    assert(initialAssignments.length <= 16, "Target Tiny initial assignment budget exceeded")
    const portIds = [...new Set<number>([...segments.flatMap((entry: number[]) => entry.slice(1, 3)),
      ...initialAssignments.flatMap((entry: RuntimeObject) => [entry.fromPortId, entry.toPortId])])]
    assert(portIds.length <= 32 && portIds.every(Number.isInteger), "Target Tiny port IDs unavailable or exceed budget")
    const select = (object: RuntimeObject | undefined, fields: string[]): RuntimeObject | null => object ?
      structuredClone(Object.fromEntries(fields.filter(key => object[key] !== undefined).map(key => [key, object[key]]))) : null
    const geometryFields = ["capacityMeshNodeId", "center", "width", "height", "availableZ"]
    const context: RuntimeObject = {
      available: true, capture: "Solved selected Tiny state before the first high-density step",
      targetNodeId, regionId,
      sourceCounts: { regions: state.regionSegments.length, ports: topology.portCount, routes: problem.routeCount,
        initialAssignments: problem.initialAssignments?.length ?? null },
      fullRegionSegmentsSummary: valueSummary(state.regionSegments),
      selectedSegmentCount: segments.length, selectedSegmentsSummary: valueSummary(segments),
      originalRegion: select(pathing.originalRegionById?.get(targetNodeId)?.d, geometryFields),
      uniformNode: select(pipeline.highDensityNodePortPoints?.find((node: RuntimeObject) => node.capacityMeshNodeId === targetNodeId), geometryFields),
      tinyRegion: {
        metadata: select(topology.regionMetadata[regionId], ["capacityMeshNodeId", "serializedRegionId", "bounds"]),
        centerX: topology.regionCenterX?.[regionId] ?? null, centerY: topology.regionCenterY?.[regionId] ?? null,
        width: topology.regionWidth?.[regionId] ?? null, height: topology.regionHeight?.[regionId] ?? null,
        availableZMask: topology.regionAvailableZMask?.[regionId] ?? null,
      },
      segments: segments.map(([routeId, fromPortId, toPortId]: number[]) => {
        const metadata = problem.routeMetadata?.[routeId]
        const mappedRoot = pathing.rootConnectionNameByConnectionId?.get(metadata?.connectionId)
        const connectionName = metadata?.simpleRouteConnection?.name ?? metadata?.connectionId
        const rootConnectionName = mappedRoot ?? metadata?.mutuallyConnectedNetworkId
        return { routeId, fromPortId, toPortId, numericNet: problem.routeNet?.[routeId] ?? null,
          routeIsFixed: problem.routeIsFixed?.[routeId] ?? null, mappedRootConnectionName: mappedRoot ?? null,
          mutuallyConnectedNetworkId: metadata?.mutuallyConnectedNetworkId ?? null,
          identity: pipeline.connMap ? canonicalIdentity(pipeline.connMap, { connectionName, rootConnectionName }) : { available: false },
          metadata: select(metadata, ["connectionId", "isFixed", "mutuallyConnectedNetworkId", "preloadedTraceSection"]),
          fullMetadataSummary: metadata ? valueSummary(metadata) : null }
      }),
      initialAssignments: structuredClone(initialAssignments),
      ports: portIds.map(portId => ({ portId, x: topology.portX?.[portId] ?? null,
        y: topology.portY?.[portId] ?? null, z: topology.portZ?.[portId] ?? null,
        metadata: select(topology.portMetadata?.[portId], ["serializedPortId", "portId", "pcb_port_id", "_preloadedTracePortAssignments"]),
        fullMetadataSummary: topology.portMetadata?.[portId] ? valueSummary(topology.portMetadata[portId]) : null })),
    }
    const summary = valueSummary(context)
    if (summary.bytes > 16000) return { available: false, reason: "Complete target Tiny context exceeds 16KB budget", contextSummary: summary }
    return context
  } catch (error) {
    return { available: false, reason: String(error).slice(0, 512) }
  }
}

/** Observe the owned published instance. Never step, validate, or repair twice. */
export function createHighDensityWitnessDiagnostics(options: DiagnosticOptions): {
  onSolverStarted: (event: RuntimeObject, phase: string | undefined) => void
  finish: () => RuntimeObject | null
} {
  assert.equal(options.pipelineClass, options.registeredPipelineClass)
  assert.equal(options.targetNodeId, "topology_merge_17108")
  assert.equal(options.targetPhase, "other_signals")
  const witnessGlobal = globalThis as WitnessGlobal
  const previousSink = Object.getOwnPropertyDescriptor(witnessGlobal, "__tscircuitHdWitness")
  assert.equal(witnessGlobal.__tscircuitHdWitness, undefined, "Another HD witness observer is active")
  let report: RuntimeObject | null = null
  let pipeline: RuntimeObject | undefined
  let highDensity: RuntimeObject | undefined
  let validation: { regional: RuntimeObject; attempt: number; call: number } | undefined
  const regionalAttempts = new WeakMap<object, RuntimeObject>()
  const actualRouteInputs = new WeakMap<object, Map<string, RuntimeObject>>()
  const restorations: (() => void)[] = []
  let finished = false

  const observe = (event: string, operation: () => void): void => {
    if (report?.observationErrorCount) return
    let previousReport: RuntimeObject | null = null
    let fieldBytes: RuntimeObject[] = []
    try {
      previousReport = report ? structuredClone(report) : null
      operation()
      assert(report)
      fieldBytes = Object.entries(report).map(([field, value]) => ({ field, bytes: Buffer.byteLength(JSON.stringify(value)) }))
        .sort((left, right) => right.bytes - left.bytes).slice(0, 8)
      assert(Buffer.byteLength(JSON.stringify(report)) <= MAX_REPORT_BYTES - 2048, "HD witness exceeds artifact budget")
      options.onSnapshot(report, event)
    } catch (error) {
      report = previousReport ?? { targetNodeId: options.targetNodeId, phase: options.targetPhase,
        regionalAttempts: [], observationErrorCount: 0, observationErrors: [] }
      report.observationErrorCount++
      if (report.observationErrors.length < 3) report.observationErrors.push({ event, message: String(error).slice(0, 512), fieldBytes })
    }
  }

  const wrapMethod = (object: RuntimeObject, key: string,
    factory: (original: (...args: any[]) => any) => (...args: any[]) => any): (() => void) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    const original = object[key]
    assert.equal(typeof original, "function", `Missing observed method ${key}`)
    object[key] = factory(original)
    let restored = false
    const restore = (): void => {
      if (restored) return
      restored = true
      if (descriptor) Object.defineProperty(object, key, descriptor)
      else delete object[key]
    }
    restorations.push(restore)
    return restore
  }

  const capturePreload = (): RuntimeObject => {
    assert(pipeline && highDensity)
    const originalTrace = pipeline.originalSrj.traces[16]
    assert(originalTrace && Array.isArray(originalTrace.route))
    const initialHdAfterCoarse = highDensity.fixedHdRoutes.filter(preloadMatches)
    const updatedHd = highDensity.getUpdatedFixedHdRoutes().filter(preloadMatches)
    const replacementEntries = [...highDensity.fixedRouteReplacements]
      .filter(([, route]: [string, RuntimeObject]) => preloadMatches(route))
    const relevantNames = new Set([...TARGET_PRELOAD_NAMES,
      ...initialHdAfterCoarse.map((route: RuntimeObject) => route.connectionName),
      ...updatedHd.map((route: RuntimeObject) => route.connectionName),
      ...replacementEntries.map(([name]: [string]) => name)])
    return {
      initialHdAfterCoarse: initialHdAfterCoarse.map(cloneRoute),
      updatedHd: updatedHd.map(cloneRoute),
      originalSrjTrace: {
        pcb_trace_id: originalTrace.pcb_trace_id, connection_name: originalTrace.connection_name,
        source_trace_id: originalTrace.source_trace_id, isFixed: originalTrace.isFixed,
        routePointCount: originalTrace.route.length,
        routeWindow: structuredClone(originalTrace.route.slice(51, 60)).map((point: RuntimeObject, index: number) => ({ index: index + 51, point })),
      },
      changedPreloadedSections: structuredClone(pipeline.getChangedPreloadedTraceSections()
        .filter((section: RuntimeObject) => section.traceId === originalTrace.pcb_trace_id)),
      replacementEntries: replacementEntries.map(([key, route]: [string, RuntimeObject]) => [key, cloneRoute(route)]),
      removedNames: [...highDensity.removedFixedRouteConnectionNames].filter((name: string) => relevantNames.has(name)),
      mutationMasks: structuredClone([...highDensity.preloadedTraceMutationMasks].filter(([name]: [string]) => relevantNames.has(name))),
    }
  }

  const installRegional = (regional: RuntimeObject | null): void => {
    if (!regional || regional.params.nodeWithPortPoints.capacityMeshNodeId !== options.targetNodeId || regionalAttempts.has(regional)) return
    assert(report && highDensity)
    const attempt: RuntimeObject = { index: report.regionalAttempts.length + 1, initial: solverSummary(regional) }
    regionalAttempts.set(regional, attempt)
    observe("regional-input", () => {
      assert(report && highDensity)
      assert(attempt.index <= 4, "Unexpected number of target regional attempts")
      const params = regional.params
      attempt.node = structuredClone(params.nodeWithPortPoints)
      attempt.settings = Object.fromEntries(["viaDiameter", "traceWidth", "obstacleMargin", "minClearance", "viaCopperClearance",
        "viaToPadClearance", "layerCount", "allowBlindAndBuriedVias", "effort"].map(key => [key, params[key]]))
      attempt.movableNames = [...params.movablePreloadedConnectionNames]
      attempt.promotedNames = [...highDensity.activeFallbackPromotedFixedRouteConnectionNames]
      attempt.sections = [...highDensity.activeFallbackFixedRouteSections].map(([key, section]: [string, RuntimeObject]) => ({
        key, start: structuredClone(section.start), end: structuredClone(section.end), sourceRoutes: section.sourceRoutes.map(cloneRoute),
      }))
      attempt.fixedObstacles = highDensity.activeFallbackFixedObstacleRoutes.map(cloneRoute)
      attempt.preload = capturePreload()
      report.regionalAttempts.push(attempt)
    })
    wrapMethod(regional, "validateCandidateWithCleanup", original => function (this: RuntimeObject, ...args: any[]): any {
      const previousValidation = validation
      validation = { regional: this, attempt: attempt.index, call: 0 }
      try { return Reflect.apply(original, this, args) }
      finally { validation = previousValidation }
    })
    wrapMethod(regional, "validateCandidateRoutes", original => function (this: RuntimeObject, ...args: any[]): any {
      if (validation?.regional === this) validation.call++
      return Reflect.apply(original, this, args)
    })
    wrapMethod(regional, "step", original => function (this: RuntimeObject, ...args: any[]): any {
      const result = Reflect.apply(original, this, args)
      if ((this.solved || this.failed) && !attempt.final) observe("regional-outcome", () => {
        assert(report && highDensity)
        attempt.final = solverSummary(this)
        if (this.solved && !report.firstPrivateCandidate) report.firstPrivateCandidate = {
          attempt: attempt.index, routes: this.getOutput().map(cloneRoute),
          parentNode: structuredClone(highDensity.activeNode),
          parentSections: structuredClone(attempt.sections), parentFixedObstacles: structuredClone(attempt.fixedObstacles),
          preloadBeforeParent: capturePreload(),
        }
      })
      return result
    })
  }

  witnessGlobal.__tscircuitHdWitness = (event: RuntimeObject): void => {
    if (!report || !highDensity || report.observationErrorCount) return
    if (event.event === "single-route-options") {
      if (highDensity.activeNode?.capacityMeshNodeId !== options.targetNodeId || report.firstRawViaRejection) return
      // Save the actual arguments at their construction, before the route search.
      // This branch keeps only tiny per-connection records, with no artifact I/O.
      try {
        const input = event.options
        const record: RuntimeObject = { solver: event.solver.getSolverName(),
          solverIterations: event.solver.iterations, optionKeys: Object.keys(input) }
        for (const key of ["connectionName", "rootConnectionName", "regionId", "A", "B", "bounds", "availableZ",
          "layerCount", "viaDiameter", "traceThickness", "obstacleMargin", "allowBlindAndBuriedVias", "priorityCoordinateScale", "hyperParameters"])
          if (input[key] !== undefined) record[key] = structuredClone(input[key])
        record.obstaclesPresent = Object.hasOwn(input, "obstacles")
        record.boardObstaclesPresent = Object.hasOwn(input, "boardObstacles")
        record.futureConnectionCount = input.futureConnections?.length
        record.obstacleRoutes = input.obstacleRoutes.map((route: RuntimeObject) => ({
          connectionName: route.connectionName, rootConnectionName: route.rootConnectionName,
          routePointCount: route.route.length, viaCount: route.vias.length,
        }))
        const records = actualRouteInputs.get(event.solver) ?? new Map<string, RuntimeObject>()
        records.set(input.connectionName, record)
        actualRouteInputs.set(event.solver, records)
      } catch (error) {
        report.observationErrorCount++
        if (report.observationErrors.length < 3) report.observationErrors.push({ event: event.event, message: String(error).slice(0, 512) })
      }
    } else if (event.event === "preloaded-via-conflict") {
      if (!validation || validation.call !== 1 || report.firstRawViaRejection) return
      const current = validation
      observe("first-raw-via-rejection", () => {
        assert(report)
        report.firstRawViaRejection = {
          attempt: current.attempt, validationCall: current.call,
          route: cloneRoute(event.route), routeIdentity: canonicalIdentity(event.connMap, event.route),
          via: structuredClone(event.via), obstacle: structuredClone(event.obstacle),
          obstacleIdentities: event.obstacle.connectedTo.map((id: string) => ({ id,
            net: event.connMap.getNetConnectedToId(id), isCanonicalNetKey: Object.hasOwn(event.connMap.netMap, id) })),
          obstacleZLayers: structuredClone(event.obstacleZLayers), layerCount: event.layerCount,
          allowBlindAndBuriedVias: event.allowBlindAndBuriedVias,
          viaToPadClearance: event.viaToPadClearance, actualDistance: event.actualDistance, requiredDistance: event.requiredDistance,
          searchInputs: searchInputs(current.regional, event.obstacle, event.route.connectionName, actualRouteInputs),
          regionalSettings: nodeSummary(current.regional.params.nodeWithPortPoints),
          nearbyBoardObstacles: nearbyBoardObstacles(current.regional, event),
        }
      })
    } else if (event.event === "parent-copper-conflict") {
      if (event.parent !== highDensity || highDensity.activeNode?.capacityMeshNodeId !== options.targetNodeId || report.firstParentConflict) return
      observe("first-parent-conflict", () => {
        assert(report)
        report.firstParentConflict = {
          attempt: regionalAttempts.get(highDensity!.activeFallbackSolver)?.index,
          left: cloneRoute(event.left), right: cloneRoute(event.right),
          leftIdentity: canonicalIdentity(event.connMap, event.left), rightIdentity: canonicalIdentity(event.connMap, event.right),
          clearance: event.clearance, leftBounds: structuredClone(event.leftBounds), layerCount: event.layerCount,
          allowBlindAndBuriedVias: event.allowBlindAndBuriedVias,
        }
      })
    }
  }
  restorations.push(() => {
    if (previousSink) Object.defineProperty(witnessGlobal, "__tscircuitHdWitness", previousSink)
    else delete witnessGlobal.__tscircuitHdWitness
  })

  const installHighDensity = (solver: RuntimeObject): void => {
    assert.equal(highDensity, undefined)
    highDensity = solver
    assert(pipeline && report)
    report.coarseTargetContext = coarseTargetContext(pipeline, options.targetNodeId)
    const inspectRegional = (regional: RuntimeObject | null): void => {
      if (!regional) return
      if (regional.params.nodeWithPortPoints.capacityMeshNodeId !== options.targetNodeId) return
      if (regionalAttempts.has(regional)) return
      observe("regional-hook", () => installRegional(regional))
    }
    wrapMethod(solver, "step", original => function (this: RuntimeObject, ...args: any[]): any {
      inspectRegional(this.activeFallbackSolver)
      const result = Reflect.apply(original, this, args)
      inspectRegional(this.activeFallbackSolver)
      return result
    })
  }

  return {
    onSolverStarted(event: RuntimeObject, phase: string | undefined): void {
      assert.equal(report, null)
      assert.equal(phase, options.targetPhase)
      const input = event.solverParams?.input
      assert(input && Array.isArray(input.connections))
      report = { instrumentation: "bounded observed predicates and owned-instance lifecycle; no routing policy changes",
        targetNodeId: options.targetNodeId, phase, inputNetCount: input.connections.length,
        regionalAttempts: [], observationErrorCount: 0, observationErrors: [] }
      const restorePipeline = wrapMethod(options.pipelineClass.prototype, "step", original => function (this: RuntimeObject, ...args: any[]): any {
        if (!pipeline) observe("pipeline-instance", () => {
          assert.equal(this.originalSrj.connections, input.connections)
          assert.equal(this.originalSrj.traces, input.traces)
          pipeline = this
        })
        if (pipeline && this !== pipeline) observe("unexpected-pipeline-instance", () => { assert.equal(this, pipeline) })
        const result = Reflect.apply(original, this, args)
        if (this.highDensityRouteSolver && !highDensity) {
          observe("high-density-hook", () => installHighDensity(this.highDensityRouteSolver))
          restorePipeline()
        }
        return result
      })
    },
    finish(): RuntimeObject | null {
      if (finished) return report
      finished = true
      if (report) observe("finished", () => {
        assert(report)
        report.targetObserved = report.regionalAttempts.length > 0
        if (highDensity) report.highDensityFinal = solverSummary(highDensity)
      })
      for (const restore of restorations.reverse()) restore()
      return report
    },
  }
}
