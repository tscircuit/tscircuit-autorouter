// Dormant Bun/Node prototype; no production pipeline imports this factory.
import { types as utilTypes } from "node:util"
import * as mathUtils from "@tscircuit/math-utils"
import * as matrixUtils from "transformation-matrix"
import * as viaUtils from "high-density-repair03/lib/utils/getViaLayers"
import * as layerUtils from "high-density-repair03/lib/utils/mapZToLayerName"
import { hasPinnedNativeIndexedDrcFunctionSources } from "./hasPinnedNativeIndexedDrcFunctionSources"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  Pipeline9MemoizedAutoroutingDrcEngine,
  readNativeIndexedDrcSpatialHashObservationContract,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair03/Pipeline9MemoizedAutoroutingDrcEngine"

type Srj = ConstructorParameters<typeof Pipeline9MemoizedAutoroutingDrcEngine>[0]
type Options = NonNullable<ConstructorParameters<typeof Pipeline9MemoizedAutoroutingDrcEngine>[1]>
type Traces = Parameters<Pipeline9MemoizedAutoroutingDrcEngine["evaluate"]>[0]
type Result = ReturnType<Pipeline9MemoizedAutoroutingDrcEngine["evaluate"]>
type Contract = {
  object: object
  parent: object | null
  keys: readonly PropertyKey[]
  descriptors: readonly PropertyDescriptor[]
}
export type NativeIndexedConnectivityMemoStats = {
  evaluations: number
  admittedEvaluations: number
  nativeEvaluations: number
  sameNameFastReturns: number
  originalPredicateCalls: number
  memoHits: number
  memoEntries: number
  entryLimitSkips: number
  guardObjects: number
  guardVisits: number
  guardProperties: number
  intrinsicObjects: number
  intrinsicProperties: number
}

const getDescriptor = Object.getOwnPropertyDescriptor
const getPrototype = Object.getPrototypeOf
const defineProperty = Object.defineProperty
const ownKeys = Reflect.ownKeys
const deleteProperty = Reflect.deleteProperty
const apply = Reflect.apply
const own = Object.hasOwn
const same = Object.is
const isProxy = utilTypes.isProxy
// The native source printer is anchored by the original module-first metadata,
// rather than a potentially replaced current Function.prototype.toString.
const spatialContract = readNativeIndexedDrcSpatialHashObservationContract()
const nativeGlobals = ["Object", "Array", "Math", "Number", "String", "Symbol", "Map", "Set", "WeakMap", "WeakSet", "Reflect", "Function", "ArrayBuffer", "Float64Array", "Uint32Array", "Error", "parseInt", "parseFloat", "isFinite", "isNaN"]
const globalDescriptors: PropertyDescriptor[] = []
let proxyObjectProvenance = true
const globalValues: Record<string, object> = {}
for (let index = 0; index < nativeGlobals.length; index++) {
  const name = nativeGlobals[index]!, descriptor = getDescriptor(globalThis, name)!
  defineProperty(globalDescriptors, index, { configurable: true, enumerable: true, writable: true, value: descriptor })
  const slot = descriptor && getDescriptor(descriptor, "value")
  const valid = slot && slot.value !== null && (typeof slot.value === "object" || typeof slot.value === "function")
  if (!valid) proxyObjectProvenance = false
  defineProperty(globalValues, name, { configurable: true, enumerable: true, writable: true, value: valid ? slot.value : {} })
}

function captureContract(object: object): Contract {
  if (isProxy(object)) { proxyObjectProvenance = false; return { object, parent: null, keys: [], descriptors: [] } }
  const keys = ownKeys(object), descriptors: PropertyDescriptor[] = []
  for (let index = 0; index < keys.length; index++) defineProperty(descriptors, index, { configurable: true, enumerable: true, writable: true, value: getDescriptor(object, keys[index]!)! })
  return { object, parent: getPrototype(object), keys, descriptors }
}

function ownDataValue(object: object, key: PropertyKey): unknown {
  const descriptor = getDescriptor(object, key)
  if (!descriptor) return undefined
  const slot = getDescriptor(descriptor, "value")
  if (!slot) return undefined
  const value = slot.value
  return value
}

// Inspect every builtin function/getter on the reachable intrinsic objects, not
// merely a small hot-method list. Indexed loops avoid invoking collection hooks
// while deciding whether a pre-import wrapper belongs to the native domain.
function dataPrototype(constructor: object): object {
  if (isProxy(constructor)) { proxyObjectProvenance = false; return {} }
  const prototype = ownDataValue(constructor, "prototype")
  if ((typeof prototype !== "object" && typeof prototype !== "function") || prototype === null) { proxyObjectProvenance = false; return {} }
  if (isProxy(prototype)) { proxyObjectProvenance = false; return {} }
  return prototype
}
const functionPrototype = dataPrototype(globalValues.Function!)
const functionSource = spatialContract.nativeFunctionSource
const isArray = ownDataValue(globalValues.Array!, "isArray") as typeof Array.isArray
const nativeObjects = [dataPrototype(globalValues.Object!), globalValues.Object!, globalValues.Array!, dataPrototype(globalValues.Array!),
  globalValues.Math!, globalValues.Number!, dataPrototype(globalValues.Number!), globalValues.String!, dataPrototype(globalValues.String!),
  globalValues.Symbol!, dataPrototype(globalValues.Symbol!), globalValues.Map!, dataPrototype(globalValues.Map!), globalValues.Set!, dataPrototype(globalValues.Set!),
  globalValues.WeakMap!, dataPrototype(globalValues.WeakMap!), globalValues.WeakSet!, dataPrototype(globalValues.WeakSet!), globalValues.Reflect!,
  globalValues.Function!, functionPrototype, globalValues.ArrayBuffer!, dataPrototype(globalValues.ArrayBuffer!),
  globalValues.Float64Array!, dataPrototype(globalValues.Float64Array!), globalValues.Uint32Array!, dataPrototype(globalValues.Uint32Array!),
  getPrototype(dataPrototype(globalValues.Float64Array!))!, globalValues.Error!, dataPrototype(globalValues.Error!)]
function nativeSource(value: unknown): boolean {
  if (typeof value !== "function" || typeof functionSource !== "function" || isProxy(value)) return false
  const source = apply(functionSource, value, []) as string
  const prefix = "function "
  for (let index = 0; index < prefix.length; index++) if (source[index] !== prefix[index]) return false
  let cursor = prefix.length
  const nameStart = cursor
  while (cursor < source.length && source[cursor] !== "(") {
    if (source[cursor] === "{" || source[cursor] === "}" || source[cursor] === "\n" || source[cursor] === "\r") return false
    cursor++
  }
  // Bound functions stringify as anonymous native functions; they can still call
  // arbitrary JavaScript. Only the actual callable Function.prototype is allowed
  // to have the anonymous form in this builtin inventory.
  if (cursor === nameStart && value !== functionPrototype) return false
  if (source[cursor] !== "(" || source[cursor + 1] !== ")") return false
  cursor += 2
  const body = ["{", "[native code]", "}"]
  for (let token = 0; token < body.length; token++) {
    while (source[cursor] === " " || source[cursor] === "\t" || source[cursor] === "\r" || source[cursor] === "\n") cursor++
    const expected = body[token]!
    for (let index = 0; index < expected.length; index++) if (source[cursor + index] !== expected[index]) return false
    cursor += expected.length
  }
  return cursor === source.length
}
let nativeFunctionProvenance = nativeSource(functionSource) && nativeSource(isProxy) && nativeSource(isArray)
for (let objectIndex = 0; objectIndex < nativeObjects.length; objectIndex++) {
  const object = nativeObjects[objectIndex]!
  if (isProxy(object)) { proxyObjectProvenance = false; continue }
  const keys = ownKeys(object)
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    const descriptor = getDescriptor(object, keys[keyIndex]!)!
    for (let fieldIndex = 0; fieldIndex < 3; fieldIndex++) {
      const field = ["value", "get", "set"][fieldIndex]!
      const slot = getDescriptor(descriptor, field)
      if (slot && typeof slot.value === "function" && !nativeSource(slot.value)) nativeFunctionProvenance = false
    }
  }
}
for (let index = 0; index < nativeGlobals.length; index++) {
  const descriptor = globalDescriptors[index]!, value = descriptor && getDescriptor(descriptor, "value")
  if (value && typeof value.value === "function" && !nativeSource(value.value)) nativeFunctionProvenance = false
}

const contracts: Contract[] = []
for (let index = 0; index < nativeObjects.length; index++) defineProperty(contracts, index, { configurable: true, enumerable: true, writable: true, value: captureContract(nativeObjects[index]!) })
defineProperty(contracts, contracts.length, { configurable: true, enumerable: true, writable: true, value: captureContract(dataPrototype(ConnectivityMap)) })
defineProperty(contracts, contracts.length, { configurable: true, enumerable: true, writable: true, value: spatialContract.engineDefinition })
defineProperty(contracts, contracts.length, { configurable: true, enumerable: true, writable: true, value: spatialContract.engineConstructorDefinition })
// Iterator construction occurs only after all collection functions are native.
if (nativeFunctionProvenance && proxyObjectProvenance) {
  const iteratorObjects = [getPrototype([][Symbol.iterator]()), getPrototype(getPrototype([][Symbol.iterator]()))!,
    getPrototype(new Map()[Symbol.iterator]()), getPrototype(new Set()[Symbol.iterator]())]
  for (let index = 0; index < iteratorObjects.length; index++) {
    const contract = captureContract(iteratorObjects[index]!)
    defineProperty(contracts, contracts.length, { configurable: true, enumerable: true, writable: true, value: contract })
    for (let slot = 0; slot < contract.descriptors.length; slot++) {
      const descriptor = contract.descriptors[slot]!
      for (let fieldIndex = 0; fieldIndex < 3; fieldIndex++) {
        const field = ["value", "get", "set"][fieldIndex]!
        // Iterator tag accessors are not read by the native or guard span.
        // Bun exposes anonymous native getters there; no proof relies on them.
        if (contract.keys[slot] === Symbol.toStringTag && field !== "value") continue
        const value = getDescriptor(descriptor, field)
        if (value && typeof value.value === "function" && !nativeSource(value.value)) nativeFunctionProvenance = false
      }
    }
  }
}
const dependencyContracts: Contract[] = []
const namespaces = [mathUtils, matrixUtils, viaUtils, layerUtils]
for (let namespaceIndex = 0; namespaceIndex < namespaces.length; namespaceIndex++) {
  const namespace = namespaces[namespaceIndex]!
  defineProperty(dependencyContracts, dependencyContracts.length, { configurable: true, enumerable: true, writable: true, value: captureContract(namespace) })
  const defaultDescriptor = getDescriptor(namespace, "default")
  if (defaultDescriptor && own(defaultDescriptor, "value") && defaultDescriptor.value !== null && (typeof defaultDescriptor.value === "object" || typeof defaultDescriptor.value === "function")) {
    defineProperty(dependencyContracts, dependencyContracts.length, { configurable: true, enumerable: true, writable: true, value: captureContract(defaultDescriptor.value) })
  }
}
const pinnedFunctionProvenance = Pipeline9MemoizedAutoroutingDrcEngine === spatialContract.originalEngineConstructor
  && dataPrototype(Pipeline9MemoizedAutoroutingDrcEngine) === spatialContract.engineDefinition.object
  && nativeFunctionProvenance && proxyObjectProvenance && hasPinnedNativeIndexedDrcFunctionSources(
  Pipeline9MemoizedAutoroutingDrcEngine, ConnectivityMap, { math: mathUtils, matrix: matrixUtils, via: viaUtils, layers: layerUtils },
  functionSource,
)
const originalPredicate = ownDataValue(Pipeline9MemoizedAutoroutingDrcEngine.prototype, "areConnected") as
  (this: Pipeline9MemoizedAutoroutingDrcEngine, left: string, right: string) => boolean
const memoEntryLimit = 65_536

function descriptorMatches(actual: PropertyDescriptor | undefined, expected: PropertyDescriptor): boolean {
  if (!actual) return false
  const fields = ["value", "get", "set", "writable", "enumerable", "configurable"] as const
  for (let i = 0; i < fields.length; i++) {
    const key = fields[i]!, present = own(actual, key), originalPresent = own(expected, key)
    if (present !== originalPresent || (present && !same(actual[key], expected[key]))) return false
  }
  return true
}

function matchesContract(contract: Contract, stats: NativeIndexedConnectivityMemoStats): boolean {
  stats.intrinsicObjects++
  if (getPrototype(contract.object) !== contract.parent) return false
  const keys = ownKeys(contract.object)
  if (keys.length !== contract.keys.length) return false
  for (let i = 0; i < keys.length; i++) {
    stats.intrinsicProperties++
    if (keys[i] !== contract.keys[i] || !descriptorMatches(getDescriptor(contract.object, keys[i]!), contract.descriptors[i]!)) return false
  }
  return true
}

function nativeObservationContract(stats: NativeIndexedConnectivityMemoStats): boolean {
  if (!nativeFunctionProvenance || !proxyObjectProvenance || !pinnedFunctionProvenance) return false
  // Object.prototype goes first, so descriptor metadata cannot acquire a custom
  // inherited getter before later reflection reads are checked.
  for (let i = 0; i < contracts.length; i++) if (!matchesContract(contracts[i]!, stats)) return false
  if (!matchesContract(spatialContract, stats)) return false
  for (let i = 0; i < dependencyContracts.length; i++) if (!matchesContract(dependencyContracts[i]!, stats)) return false
  for (let i = 0; i < nativeGlobals.length; i++) {
    stats.intrinsicProperties++
    if (!descriptorMatches(getDescriptor(globalThis, nativeGlobals[i]!), globalDescriptors[i]!)) return false
  }
  return true
}

/** All input aliases are data-only; no intervening numeric/helper read can call user code. */
function plainDataGraph(roots: unknown[], stats: NativeIndexedConnectivityMemoStats, retain?: object[]): boolean {
  const seen = new WeakSet<object>(), pending = roots.slice()
  while (pending.length > 0) {
    stats.guardVisits++
    const value = pending.pop()
    if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") continue
    if (typeof value !== "object" || isProxy(value)) return false
    if (seen.has(value)) continue
    seen.add(value)
    if (retain) retain[retain.length] = value
    const parent = getPrototype(value)
    if (parent !== Object.prototype && parent !== null && parent !== Array.prototype && parent !== ConnectivityMap.prototype) return false
    stats.guardObjects++
    const keys = ownKeys(value)
    if (isArray(value)) {
      const length = getDescriptor(value, "length")
      if (!length || !own(length, "value")) return false
      // Dense arrays are the native task domain; inherited/missing slots remain native.
      for (let i = 0; i < length.value; i++) { stats.guardProperties++; if (!getDescriptor(value, i)) return false }
    }
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!, descriptor = getDescriptor(value, key)
      stats.guardProperties++
      if (!descriptor || !own(descriptor, "value")) return false
      if (parent === ConnectivityMap.prototype && key !== "netMap" && key !== "idToNetMap") return false
      pending.push(descriptor.value)
    }
  }
  return true
}

/** One private native engine, with a fresh memo only inside each original synchronous evaluate. */
export function createPrivatelyMemoizedIndexedDrcEvaluator(srj: Srj, options: Options = {}): {
  evaluate: (traces: Traces) => Result
  getStats: () => NativeIndexedConnectivityMemoStats
  getRunStats: () => Pipeline9MemoizedAutoroutingDrcEngine["lastRunStats"]
} {
  const stats: NativeIndexedConnectivityMemoStats = { evaluations: 0, admittedEvaluations: 0, nativeEvaluations: 0,
    sameNameFastReturns: 0, originalPredicateCalls: 0, memoHits: 0, memoEntries: 0, entryLimitSkips: 0,
    guardObjects: 0, guardVisits: 0, guardProperties: 0, intrinsicObjects: 0, intrinsicProperties: 0 }
  const originalObjects: object[] = []
  const nativeConstruction = nativeObservationContract(stats) && plainDataGraph([srj, options], stats, originalObjects)
  // This is the only native construction. Quiet eligibility does not evaluate
  // input getters; custom constructors/geometry hooks retain their original events.
  const engine = new Pipeline9MemoizedAutoroutingDrcEngine(srj, options)
  let eligibleLifetime = nativeConstruction
  return {
    evaluate(traces: Traces): Result {
      stats.evaluations++
      if (!eligibleLifetime || !nativeObservationContract(stats)) {
        eligibleLifetime = false
        stats.nativeEvaluations++
        return engine.evaluate(traces)
      }
      // Constructor-retained arrays/maps can outlive replaced caller fields.
      // Revalidate the original object graph as well as current evaluation roots.
      const roots: unknown[] = [srj, options, traces]
      for (let index = 0; index < originalObjects.length; index++) roots[roots.length] = originalObjects[index]!
      if (!plainDataGraph(roots, stats)) {
        // A native callback could publish/mutate the private engine. Trust cannot
        // return after such an open span, even if inputs/methods are restored.
        eligibleLifetime = false
        stats.nativeEvaluations++
        return engine.evaluate(traces)
      }
      stats.admittedEvaluations++
      const memo = new Map<string, Map<string, boolean>>()
      let entries = 0
      const predicate = (left: string, right: string): boolean => {
        if (left === right) { stats.sameNameFastReturns++; return true }
        const previous = memo.get(left)
        if (previous?.has(right)) { stats.memoHits++; return previous.get(right)! }
        stats.originalPredicateCalls++
        // Keep asymmetric aliases and false answers exactly as native. The first
        // miss happens at the original guard position, including any original error.
        const result = apply(originalPredicate, engine, [left, right]) as boolean
        if (entries < memoEntryLimit) {
          const row = previous ?? new Map<string, boolean>()
          if (!previous) memo.set(left, row)
          row.set(right, result)
          entries++; stats.memoEntries++
        } else stats.entryLimitSkips++
        return result
      }
      const old = getDescriptor(engine, "areConnected")
      if (old) throw new Error("Private indexed DRC engine unexpectedly owns its connectivity predicate")
      defineProperty(engine, "areConnected", { configurable: true, writable: true, value: predicate })
      try { return engine.evaluate(traces) }
      finally { if (!deleteProperty(engine, "areConnected")) throw new Error("Private indexed DRC connectivity span could not retire") }
    },
    getStats(): NativeIndexedConnectivityMemoStats { return { ...stats } },
    getRunStats(): Pipeline9MemoizedAutoroutingDrcEngine["lastRunStats"] { return { ...engine.lastRunStats } },
  }
}
