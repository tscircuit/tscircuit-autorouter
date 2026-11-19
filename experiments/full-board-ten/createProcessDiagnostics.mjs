import assert from "node:assert/strict"
import { createHash } from "node:crypto"

// Benchmark-only observers. Calls, return values, inputs, budgets and errors pass through.
export function createProcessDiagnostics({ pipelineClass, registeredPipelineClass, phase, deep, write, onSnapshot }) {
  assert.equal(pipelineClass, registeredPipelineClass)
  const started = performance.now()
  const observed = new WeakMap()
  const active = new Set()
  const report = { phase, mode: "passive native instance observation", stages: [], classes: {}, events: [], omittedEvents: 0, captures: [], omittedCaptures: 0, observationMs: 0 }
  let pipeline
  let serial = 0
  let lastSaved = -Infinity
  let captureBytes = 0
  const restores = new Map()
  const captured = new Map()
  const descriptor = Object.getOwnPropertyDescriptor(pipelineClass.prototype, "_step")
  const original = pipelineClass.prototype._step

  function data(value, depth = 0) {
    if (value === undefined) return null
    if (typeof value === "function") return { callback: value.name, notInvoked: true }
    if (typeof value === "number" && !Number.isFinite(value)) return String(value)
    if (value === null || typeof value !== "object") return value
    if (depth > 12) return { omitted: "depth" }
    if (Array.isArray(value)) return value.map(item => data(item, depth + 1))
    if (value instanceof Map || value instanceof Set) return { size: value.size }
    if (Object.getPrototypeOf(value) !== Object.prototype) return { className: value.constructor.name }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, data(item, depth + 1)]))
  }
  function scalarFields(value) {
    if (!value || typeof value !== "object") return null
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item === null || ["number", "string", "boolean"].includes(typeof item)))
  }
  function state(solver) {
    const fields = ["iterations", "MAX_ITERATIONS", "solved", "failed", "error", "progress", "searchIterations", "baseSearchBudgetIters", "totalRipEvents", "candidateSearchCount", "candidateSearchBudget", "candidateSearchBudgetExhausted", "attemptedCandidateCount", "acceptedCandidateCount", "passIndex", "errorIndex", "regionIndex", "traceIndex", "spanCount"]
    const row = Object.fromEntries(fields.filter(key => solver[key] !== undefined).map(key => [key, solver[key]]))
    return { ...row, className: roleOf(solver), bundleClassName: solver.constructor.name, phase: typeof solver.phase === "string" ? solver.phase : solver.state?.phase, stage: solver.pipelineDef?.[solver.currentPipelineStepIndex]?.solverName, stats: scalarFields(solver.stats), result: scalarFields(solver.result), activeNodeId: solver.activeNode?.capacityMeshNodeId, activeConnection: data(solver.activeConnection), unsolvedCount: solver.unsolvedNodePortPoints?.length ?? solver.unsolvedConnections?.length, routeCount: solver.routes?.length, currentErrorCount: solver.currentErrors?.length, bestErrorCount: solver.bestErrors?.length }
  }
  function event(row) {
    if (report.events.length >= 3000) { report.events.splice(1000, 1); report.omittedEvents++ }
    report.events.push({ elapsedMs: performance.now() - started, ...row })
  }
  function capture(label, value) {
    if (!deep) return
    const bytes = JSON.stringify(data(value))
    const digest = createHash("sha256").update(bytes).digest("hex")
    if (captured.has(digest)) return captured.get(digest)
    if (captureBytes + bytes.length > 24 * 1024 * 1024 || report.captures.length >= 180) { report.omittedCaptures++; return }
    captureBytes += bytes.length
    const name = `process-${phase.index}-${report.captures.length}-${label.replace(/[^a-zA-Z0-9_-]/g, "_")}.json.gz`
    write(name, bytes, true)
    const reference = { name, sha256: digest, bytes: bytes.length }
    report.captures.push(reference)
    captured.set(digest, reference)
    return reference
  }
  function routes(solver) {
    const rows = {}
    for (const key of ["routes", "hdRoutes", "inputHdRoutes", "guardedInputHdRoutes", "mergedHdRoutes", "simplifiedHdRoutes", "currentRoutes", "bestRoutes", "combinedOutput", "output"]) {
      const items = solver[key]
      if (!Array.isArray(items) || !items.length || !Array.isArray(items[0]?.route)) continue
      const bytes = JSON.stringify(items)
      rows[key] = { count: items.length, points: items.reduce((n, route) => n + route.route.length, 0), vias: items.reduce((n, route) => n + (route.vias?.length ?? 0), 0), sha256: createHash("sha256").update(bytes).digest("hex") }
      capture(`${solver.constructor.name}-${key}`, items)
    }
    return rows
  }
  function inputDetail(input) {
    if (!input) return null
    const result = {}
    for (const [key, value] of Object.entries(input)) {
      if (["srj", "routes", "obstacles"].includes(key)) result[key] = capture(`shared-${key}`, value)
      else if (["task", "pathInput"].includes(key)) result[key] = inputDetail(value)
      else result[key] = data(value)
    }
    return result
  }
  function roleOf(solver) {
    if ("activeB01Solver" in solver) return "Pipeline9HighDensitySolver"
    if (solver.pipelineDef && "inputNewHdRoutes" in solver) return "Pipeline9JointDrcRepairSolver"
    if (solver.budget && solver.state && solver.result && "attemptedRegionCount" in solver.result) return "Pipeline9BoundedRegionalRepairSolver"
    if ("candidateSearchBudget" in solver && "currentErrors" in solver) return "Pipeline9RegionalB01RepairSolver"
    if (solver.input?.maxPathSearchCalls !== undefined && solver.input?.maxPathSearchNodes !== undefined) return "NegotiateTraceClearanceSolver"
    if (solver.input?.task?.pathInput && solver.forward) return "PairedClearancePathSolver"
    if (solver.input?.start && solver.input?.end && "barrierCount" in solver) return "FindClearancePathSolver"
    return solver.constructor.name
  }
  function detail(solver, parent) {
    const result = { ...state(solver), node: data(parent?.activeNode), fallbackReason: parent?.activeFallbackReason }
    if (roleOf(solver) === "NegotiateTraceClearanceSolver") {
      const negotiation = parent?.state?.negotiation
      result.input = inputDetail(solver.input)
      result.lockedPointIndices = data(negotiation?.region?.lockedPointIndices)
      result.region = data(negotiation?.region)
      result.allowance = data(negotiation?.allowance)
    }
    if (/^(Find|Paired)ClearancePathSolver$/.test(roleOf(solver))) result.input = inputDetail(solver.input)
    if (/RegionalFallback|HighDensitySolverB01/.test(solver.constructor.name)) {
      const params = solver.params
      result.parameters = params ? data(Object.fromEntries(Object.entries(params).filter(([key]) => !["connMap", "colorMap", "nodePfById"].includes(key)))) : null
      result.currentRoutes = data(solver.routes)
      result.node = data(parent?.activeNode)
    }
    return result
  }
  function attach(solver, parent, relation, level = 0) {
    if (!solver || typeof solver._step !== "function" || observed.has(solver) || level > 9) return
    const id = serial++
    const className = roleOf(solver)
    const aggregate = report.classes[className] ??= { started: 0, solved: 0, failed: 0, iterations: 0, maxIterationsSeen: 0 }
    aggregate.started++
    const stage = parent === pipeline
    const repair = /Pipeline9JointDrc|Pipeline9BoundedRegional|Pipeline9RegionalB01|NegotiateTraceClearance|^(Find|Paired)ClearancePath/.test(className)
    const row = { id, parentId: observed.get(parent)?.id ?? null, relation, className, startedMs: performance.now() - started, initial: state(solver) }
    if (stage) report.stages.push(row)
    const info = { id, solver, parent, row, stage, repair, lastPhase: undefined, finished: false }
    observed.set(solver, info)
    active.add(info)
    if (repair) { event({ type: "child-start", id, relation, parentId: row.parentId, state: row.initial }); capture(`${id}-input`, detail(solver, parent)) }
    const prior = Object.getOwnPropertyDescriptor(solver, "_step")
    const step = solver._step
    const childKeys = className === "Pipeline9HighDensitySolver" ? ["activeRegularSolver", "activeB01Solver", "activeFallbackSolver"] : ["activeSubSolver"]
    function observeChildren() {
      for (const key of childKeys) attach(solver[key], solver, key, level + 1)
    }
    function finish() {
      if (info.finished || (!solver.solved && !solver.failed)) return
      info.finished = true
      active.delete(info)
      const final = state(solver)
      aggregate[solver.failed ? "failed" : "solved"]++
      aggregate.iterations += solver.iterations
      aggregate.maxIterationsSeen = Math.max(aggregate.maxIterationsSeen, solver.iterations)
      if (stage) Object.assign(row, { endedMs: performance.now() - started, final, routes: routes(solver) })
      const restore = restores.get(id)
      if (restore) { restore(); restores.delete(id) }
      if (repair || solver.failed) {
        event({ type: "child-end", id, relation, state: final, parentState: state(parent), node: data(parent?.activeNode) })
        capture(`${id}-final`, { ...detail(solver, parent), output: data(solver.output), errors: data(solver.currentErrors), result: data(solver.result) })
      }
    }
    solver._step = function (...args) {
      let tick = performance.now()
      observeChildren()
      const signature = repair ? `${solver.phase ?? solver.state?.phase}/${solver.currentPipelineStepIndex}/${solver.errorIndex}/${solver.regionIndex}` : null
      if (repair && signature !== info.lastPhase) {
        event({ type: "transition", id, state: state(solver), error: data(solver.repairableErrors?.[solver.errorIndex]), bounds: data(solver.state?.negotiation?.region?.bounds) })
        info.lastPhase = signature
      }
      report.observationMs += performance.now() - tick
      let result
      try { result = Reflect.apply(step, this, args) }
      finally {
        tick = performance.now()
        observeChildren()
        finish()
        report.observationMs += performance.now() - tick
      }
      return result
    }
    restores.set(id, () => prior ? Object.defineProperty(solver, "_step", prior) : delete solver._step)
    observeChildren()
  }
  pipelineClass.prototype._step = function (...args) {
    const tick = performance.now()
    if (!pipeline) {
      pipeline = this
      observed.set(this, { id: -1 })
      report.input = { connections: this.originalSrj.connections.length, preloadedTraces: this.originalSrj.traces?.length ?? 0, obstacles: this.originalSrj.obstacles.length, options: data(this.opts), effort: this.effort }
    }
    assert.equal(this, pipeline)
    const before = this.activeSubSolver
    attach(before, this, this.getCurrentPhase())
    report.observationMs += performance.now() - tick
    const result = Reflect.apply(original, this, args)
    const afterTick = performance.now()
    attach(this.activeSubSolver, this, this.getCurrentPhase())
    if (this.activeSubSolver !== before || (this.iterations % 8192 === 0 && performance.now() - lastSaved > 5000)) {
      onSnapshot?.(snapshot())
      lastSaved = performance.now()
    }
    report.observationMs += performance.now() - afterTick
    return result
  }
  function snapshot() {
    report.elapsedMs = performance.now() - started
    report.pipeline = pipeline ? state(pipeline) : null
    report.active = [...active].map(info => ({ id: info.id, parentId: info.row.parentId, relation: info.row.relation, state: state(info.solver) })).slice(-48)
    report.captureBytes = captureBytes
    return report
  }
  return {
    snapshot,
    finish() {
      snapshot()
      for (const info of active) {
        if (info.stage) { info.row.final = state(info.solver); info.row.routes = routes(info.solver) }
        if (info.stage || info.repair || info.solver.failed) capture(`${info.id}-interrupted`, detail(info.solver, info.parent))
      }
      for (const restore of [...restores.values()].reverse()) restore()
      Object.defineProperty(pipelineClass.prototype, "_step", descriptor)
      return snapshot()
    },
  }
}

export function createBusDiagnostics({ pipelineClass, phase, onSnapshot }) {
  const started = performance.now()
  const descriptor = Object.getOwnPropertyDescriptor(pipelineClass.prototype, "_step")
  const original = pipelineClass.prototype._step
  const report = { phase, mode: "bounded passive published bus observer", transitions: [], phaseTotals: {}, omittedTransitions: 0, observationMs: 0 }
  let pipeline
  let previous
  let phaseStarted = started
  let lastSaved = -Infinity
  function snapshot() {
    report.elapsedMs = performance.now() - started
    if (pipeline) report.pipeline = JSON.parse(JSON.stringify({ phase: pipeline.phase, solved: pipeline.solved, failed: pipeline.failed, error: pipeline.error, failureCode: pipeline.failureCode, iterations: pipeline.iterations, stats: pipeline.stats, acceptedTraces: pipeline.acceptedTraces?.length, traceCount: pipeline.traces?.length, child: pipeline.child ? { phase: pipeline.child.phase, solved: pipeline.child.solved, failed: pipeline.child.failed, error: pipeline.child.error, stats: pipeline.child.stats } : null }))
    return report
  }
  pipelineClass.prototype._step = function (...args) {
    if (!pipeline) pipeline = this
    if (this !== pipeline) return Reflect.apply(original, this, args)
    const result = Reflect.apply(original, this, args)
    const tick = performance.now()
    if (this.phase !== previous) {
      if (previous !== undefined) report.phaseTotals[previous].elapsedMs += tick - phaseStarted
      const total = report.phaseTotals[this.phase] ??= { entries: 0, elapsedMs: 0 }
      total.entries++
      if (report.transitions.length === 256) { report.transitions.splice(64, 1); report.omittedTransitions++ }
      report.transitions.push({ elapsedMs: tick - started, phase: this.phase, iterations: this.iterations, layerAttempt: this.stats.layerAttempt, carrierStrategy: this.stats.carrierStrategy, routingStage: this.stats.routingStage, traceCount: this.traces?.length, failed: this.failed, error: this.error })
      previous = this.phase
      phaseStarted = tick
    }
    if (tick - lastSaved > 5000 || this.failed || this.solved) {
      onSnapshot(snapshot())
      lastSaved = performance.now()
    }
    report.observationMs += performance.now() - tick
    return result
  }
  return { snapshot, finish() { Object.defineProperty(pipelineClass.prototype, "_step", descriptor); return snapshot() } }
}
