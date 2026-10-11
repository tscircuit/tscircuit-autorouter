import { types as utilTypes } from "node:util"

type Collector = (pool: unknown) => Record<string, number> | undefined
const descriptor = Object.getOwnPropertyDescriptor
const prototype = Object.getPrototypeOf
const apply = Reflect.apply
const isProxy = utilTypes.isProxy
const safeInteger = Number.isSafeInteger
const own = Object.hasOwn
const fields = [
  ["reservationsGranted", "referenceReservationsGranted"], ["reservationsDeclined", "referenceReservationsDeclined"],
  ["workersReserved", "referenceWorkersReserved"], ["workersRetired", "referenceWorkersRetired"],
  ["batchesCompleted", "referenceBatchesCompleted"], ["workerFactRowsCompleted", "referenceWorkerFactRowsCompleted"],
  ["mainFactRowsCompleted", "referenceMainFactRowsCompleted"], ["protocolFaults", "referenceProtocolFaults"],
  ["maxFactWorkerLanes", "referenceMaxFactWorkerLanes"], ["mainFactLaneCount", "referenceMainFactLaneCount"],
] as const

/** Capture the actual loaded package's private-reader method; source instances
 * cannot authenticate against a separately bundled package's private WeakMap. */
export function createParallelBenchmarkReferenceFactStatsCollector(autorouterModule: unknown): Collector {
  if (autorouterModule === null || (typeof autorouterModule !== "object" && typeof autorouterModule !== "function") || isProxy(autorouterModule)) return () => undefined
  const constructor = descriptor(autorouterModule, "Pipeline9LocalWorkerPool")
  if (!constructor || !own(constructor, "value") || typeof constructor.value !== "function" || isProxy(constructor.value)) return () => undefined
  const parent = descriptor(constructor.value, "prototype")
  if (!parent || !own(parent, "value") || parent.value === null || typeof parent.value !== "object" || isProxy(parent.value)) return () => undefined
  const method = descriptor(parent.value, "getNativeReferenceFactStats")
  if (!method || !own(method, "value") || typeof method.value !== "function" || isProxy(method.value)) return () => undefined
  const capturedPrototype = parent.value, capturedMethod = method.value
  return (pool: unknown): Record<string, number> | undefined => {
    if (pool === null || typeof pool !== "object" || isProxy(pool) || prototype(pool) !== capturedPrototype || descriptor(pool, "getNativeReferenceFactStats")) return undefined
    const current = descriptor(capturedPrototype, "getNativeReferenceFactStats")
    if (!current || !own(current, "value") || current.value !== capturedMethod) return undefined
    const result = apply(capturedMethod, pool, []) as unknown
    if (result === undefined) return undefined
    if (result === null || typeof result !== "object" || isProxy(result)) throw new Error("Invalid private native reference fact snapshot")
    const collected: Record<string, number> = {}
    for (let index = 0; index < fields.length; index++) {
      const field = fields[index]!, name = field[0], target = field[1], value = descriptor(result, name)
      if (!value || !own(value, "value") || !safeInteger(value.value) || value.value < 0) throw new Error(`Invalid private native reference fact counter ${name}`)
      collected[target] = value.value
    }
    if (collected.referenceMaxFactWorkerLanes! > 3 || collected.referenceMainFactLaneCount! > 1) throw new Error("Native reference fact snapshot exceeds four computing lanes")
    return collected
  }
}
