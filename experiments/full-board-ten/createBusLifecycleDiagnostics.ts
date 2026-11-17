type RuntimeObject = Record<string, any>
type SolverClass = { prototype: RuntimeObject }
type Kind = "pipeline" | "lanes"

const data = (object: unknown, key: string): any =>
  object !== null && typeof object === "object"
    ? Object.getOwnPropertyDescriptor(object, key)?.value
    : undefined
const scalar = (value: unknown): string | number | boolean | null =>
  typeof value === "string" || typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value)) ? value : null
const fields = (object: unknown, keys: string[]): RuntimeObject =>
  Object.fromEntries(keys.map(key => [key, scalar(data(object, key))]))

/** Observe only existing data properties around one original synchronous step.
 * No routing getter, predicate, generator.next(), or extra solver step is called. */
export function createBusLifecycleDiagnostics(options: {
  pipelineClass: SolverClass
  laneClass: SolverClass
  inputSha256: string
}): { snapshot: () => RuntimeObject; finish: () => RuntimeObject } {
  const limits = { instances: 128, transitions: 512, searchOutcomes: 256 }
  const started = performance.now()
  const records: RuntimeObject[] = []
  const identities = new WeakMap<object, RuntimeObject>()
  const stack: Array<RuntimeObject | undefined> = []
  const restorers: Array<() => void> = []
  const transitions: RuntimeObject[] = []
  const searchOutcomes: RuntimeObject[] = []
  const errors: string[] = []
  const capped = new Set<string>()
  let calls = 0
  let originalCalls = 0
  let finished = false
  let observing = true
  const noteError = (error: unknown): void => { observing = false; if (errors.length < 8) errors.push(String(error)) }
  const append = (rows: RuntimeObject[], row: RuntimeObject, kind: keyof typeof limits): void => {
    if (rows.length < limits[kind]) rows.push(row)
    else capped.add(kind)
  }
  const state = (solver: RuntimeObject): RuntimeObject => {
    const result = fields(solver, ["phase", "iterations", "MAX_ITERATIONS", "solved", "failed", "failureCode", "error", "attempt", "lane", "pairIndex", "pairVariant", "congestionPass", "conflictingLanes", "routingDeadline"])
    for (const key of ["traces", "acceptedTraces", "bestPartial", "escapes"])
      result[`${key}Count`] = Array.isArray(data(solver, key)) ? data(solver, key).length : null
    result.activeGenerators = ["nativeSingleCarrier", "envelopeOptimization", "surfaceFinishing", "siteRematch", "sharedPackages", "backwardPackages", "packageCoupling", "independent", "pairedNetwork", "negotiated", "pendingExitSearch", "pairSearch"].filter(key => data(solver, key) !== undefined && data(solver, key) !== null)
    result.carrierStrategy = fields(data(solver, "carrierStrategy"), ["name", "reason", "startedAtIteration"])
    const search = data(solver, "search")
    if (search) result.search = fields(search, ["expanded", "solved", "failed", "maxLength", "stepSize", "nx", "ny"])
    return result
  }
  const recordFor = (solver: RuntimeObject, kind: Kind): RuntimeObject | undefined => {
    const old = identities.get(solver)
    if (old) return old
    if (records.length === limits.instances) { capped.add("instances"); return }
    const input = data(solver, "input")
    const connections = data(input, "connections")
    if (!Array.isArray(connections) || connections.length > 128) throw Error("Unexpected diagnostic connection inventory")
    const initial = state(solver)
    const record: RuntimeObject = {
      id: records.length + 1, parentId: stack.at(-1)?.id ?? null, kind, solverRef: new WeakRef(solver), calls: 0, phaseCalls: Object.create(null),
      firstSeenMs: performance.now() - started,
      input: {
        obstacleCount: data(input, "obstacles")?.length ?? null,
        fixedTraceCount: data(input, "traces")?.length ?? 0,
        connections: connections.map(connection => {
          const terminals = data(connection, "pointsToConnect")
          if (!Array.isArray(terminals) || terminals.length > 8) throw Error("Unexpected diagnostic terminal inventory")
          return { ...fields(connection, ["name", "source_trace_id"]), terminals: terminals.map((point: unknown) => fields(point, ["x", "y", "layer", "pointId", "pcb_port_id"])) }
        }),
      },
      initial, lastRecordedState: initial,
    }
    records.push(record)
    identities.set(solver, record)
    return record
  }
  const report = (): RuntimeObject => ({
    schemaVersion: 1, phase: "byte1", inputSha256: options.inputSha256,
    observation: "Published instance lifecycle; unaccepted traces are counts only",
    limits, calls, originalCalls, originalStepExactlyOnce: calls === originalCalls,
    captureValid: finished && records.length > 0 && errors.length === 0 && capped.size === 0 && calls === originalCalls,
    observerErrors: [...errors], capped: [...capped], restored: finished,
    instances: records.map(({ solverRef, lastRecordedState, lastPhase, lastSolved, lastFailed, phaseCalls, ...record }) => {
      const solver = solverRef.deref()
      return { ...record, phaseCalls: { ...phaseCalls }, current: solver ? state(solver) : lastRecordedState,
        stateSource: solver ? "live_reference" : "last_transition", collected: !solver }
    }),
    transitions: [...transitions], searchOutcomes: [...searchOutcomes],
    scope: "Phase/child lifecycle only; generator-local site pools are not inspected; wall time is diagnostic only",
  })
  const install = (constructor: SolverClass, kind: Kind): void => {
    const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, "_step")
    if (!descriptor || typeof descriptor.value !== "function") throw Error(`Missing published ${kind} step`)
    const original = descriptor.value
    const wrapped = function(this: RuntimeObject, ...args: unknown[]): unknown {
      calls++
      let record: RuntimeObject | undefined
      let previousSearch: RuntimeObject | undefined
      try { if (observing) { record = recordFor(this, kind); previousSearch = data(this, "search"); if (record) record.calls++ } }
      catch (error) { noteError(error) }
      stack.push(record)
      try {
        originalCalls++
        return Reflect.apply(original, this, args)
      } finally {
        stack.pop()
        try {
          if (record && observing) {
            const phase = data(this, "phase"), solved = data(this, "solved"), failed = data(this, "failed")
            if (Object.hasOwn(record.phaseCalls, phase) || Object.keys(record.phaseCalls).length < 128)
              record.phaseCalls[phase] = (record.phaseCalls[phase] ?? 0) + 1
            else capped.add("phaseValues")
            if (phase !== record.lastPhase || solved !== record.lastSolved || failed !== record.lastFailed) {
              record.lastRecordedState = state(this)
              append(transitions, { id: record.id, atMs: performance.now() - started, ...record.lastRecordedState }, "transitions")
              record.lastPhase = phase; record.lastSolved = solved; record.lastFailed = failed
            }
            if (previousSearch && previousSearch !== data(this, "search"))
              append(searchOutcomes, { id: record.id, atMs: performance.now() - started, connection: fields(data(data(previousSearch, "scene"), "connection"), ["name", "source_trace_id"]), start: fields(data(previousSearch, "start"), ["x", "y", "layer"]), end: fields(data(previousSearch, "end"), ["x", "y", "layer"]), ...fields(previousSearch, ["expanded", "solved", "failed", "maxLength", "stepSize", "nx", "ny"]) }, "searchOutcomes")
          }
        } catch (error) { noteError(error) }
      }
    }
    Object.defineProperty(constructor.prototype, "_step", { ...descriptor, value: wrapped })
    restorers.push(() => Object.defineProperty(constructor.prototype, "_step", descriptor))
  }
  try { install(options.pipelineClass, "pipeline"); install(options.laneClass, "lanes") }
  catch (error) { for (const restore of restorers.reverse()) restore(); throw error }
  return {
    snapshot: report,
    finish: (): RuntimeObject => {
      if (!finished) { for (const restore of restorers.reverse()) restore(); finished = true }
      return report()
    },
  }
}
