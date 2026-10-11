import { MultiSimplifiedPathSolver, SingleSimplifiedPathSolver5 } from "@tscircuit/trace-simplification-solver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import Flatbush from "flatbush"
import RBush from "rbush"
// Capture the pinned dependency's actual classes without constructing probe
// solvers under caller hooks. tsup bundles these same native dependency files.
import { PathSimplificationGeometryIndex } from "../../../node_modules/@tscircuit/trace-simplification-solver/lib/data-structures/PathSimplificationGeometryIndex"
import { SegmentTree } from "../../../node_modules/@tscircuit/trace-simplification-solver/lib/data-structures/SegmentTree"
import type { HighDensityRoute } from "../../types/high-density-types"
import { ParallelPathQueryCertifier } from "./ParallelPathQueryCertifier"
import { ParallelPathInputScopeGraph } from "./ParallelPathInputScopeGraph"
import { getReferenceDrcProxyInspector } from "./authoritative-drc-fork/initializeReferenceDrcRuntime"

type CompleteDescriptor = {
  data: boolean; value: unknown; get: (() => unknown) | undefined; set: ((value: unknown) => void) | undefined
  writable: boolean | undefined; enumerable: boolean | undefined; configurable: boolean | undefined
}
type DescriptorEntry = { key: PropertyKey; descriptor: CompleteDescriptor }
export type ParallelPathPrototypeContract = {
  target: object
  prototype: object | null
  entries: DescriptorEntry[]
}
export type ParallelPathEligibilityStats = { checks: number; objectChecks: number; ownKeyReads: number; descriptorReads: number;
  snapshotObjects: number; snapshotProperties: number; descriptorBuiltinCalls: number
  /** Native descriptor metadata reads; private comparison records are excluded. */
  descriptorMetadataFieldReads: number; descriptorOwnFieldChecks: number; prototypeReads: number
  awaitCaptures: number; awaitChecks: number; awaitSnapshotObjects: number; awaitSnapshotProperties: number
  awaitMapEntriesCaptured: number; awaitMapEntriesCompared: number; awaitSetValuesCaptured: number; awaitSetValuesCompared: number
  awaitBufferBytesCopied: number; awaitBufferBytesCompared: number; awaitBufferGetterCalls: number
  awaitCoveredObjectsSkipped: number; awaitTypedIndexDescriptorsSkipped: number; awaitReceiverBrandChecks: number
  scopeCaptures: number; scopeChecks: number; scopeObjects: number; scopeProperties: number; scopeIndexSourceEdgesSkipped: number
  scopeControlOriginalObjects: number }
export type ParallelPathLookaheadEligibility = (() => boolean) & {
  stats: ParallelPathEligibilityStats
  /** Capture after intentional owner bookkeeping writes and before awaiting. */
  captureAwaitState(scope?: () => boolean): (() => boolean) | undefined
  /** Private native-window read set; independently callable eligibility stays full. */
  captureScope(indexes: readonly number[]): (() => boolean) | undefined
}

const getDescriptor = Object.getOwnPropertyDescriptor
const getDescriptors = Object.getOwnPropertyDescriptors
const getPrototype = Object.getPrototypeOf
const ownKeys = Reflect.ownKeys
const objectIs = Object.is
const apply = Reflect.apply
const hasOwn = Object.prototype.hasOwnProperty
const functionSource = Function.prototype.toString
const nativeUint8Array = Uint8Array
const nativeArrayBufferPrototype = ArrayBuffer.prototype
const arrayBufferByteLength = getDescriptor(nativeArrayBufferPrototype, "byteLength")!.get!
const arrayBufferDetached = getDescriptor(nativeArrayBufferPrototype, "detached")?.get
const mapForEach = Map.prototype.forEach
const setForEach = Set.prototype.forEach
const mapSize = getDescriptor(Map.prototype, "size")!.get!
const setSize = getDescriptor(Set.prototype, "size")!.get!
const nativeTypeErrorPrototype = TypeError.prototype
const weakMapGet = WeakMap.prototype.get
const weakMapSet = WeakMap.prototype.set
const awaitCheckOwners = new WeakMap<() => boolean, { owner: MultiSimplifiedPathSolver; eligibility: ParallelPathLookaheadEligibility }>()
type ScopeBinding = { owner: MultiSimplifiedPathSolver; eligibility: ParallelPathLookaheadEligibility;
  contracts: ParallelPathPrototypeContract[]; covered: WeakSet<object>; indexState: AwaitStateGraph }
const scopeCheckOwners = new WeakMap<() => boolean, ScopeBinding>()
const nativeEligibilityOwners = new WeakMap<ParallelPathLookaheadEligibility, MultiSimplifiedPathSolver>()
const nativeLookaheadWindowCapacity = 16
const globals = ["Object", "Array", "Math", "JSON", "Number", "String", "Boolean", "BigInt", "Symbol", "Map", "Set",
  "WeakMap", "WeakSet", "Reflect", "Function", "Atomics", "Promise", "Proxy", "isNaN", "isFinite", "parseInt", "parseFloat",
  "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array",
  "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array", "ArrayBuffer", "SharedArrayBuffer", "DataView",
  "Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "URL", "Worker", "structuredClone"]
const globalEntries = globals.map((key) => ({ key, descriptor: completeDescriptor(getDescriptor(globalThis, key)) }))
const sharedBufferDescriptor = globalEntries.find((entry) => entry.key === "SharedArrayBuffer")!.descriptor
const hasNativeSharedBuffer = sharedBufferDescriptor?.data && typeof sharedBufferDescriptor.value === "function"
const structuredCloneDescriptor = globalEntries.find((entry) => entry.key === "structuredClone")!.descriptor
const structuredCloneSource = structuredCloneDescriptor?.data && typeof structuredCloneDescriptor.value === "function"
  ? apply(functionSource, structuredCloneDescriptor.value, []) as string : undefined
const hasNativeStructuredClone = structuredCloneDescriptor?.data && typeof structuredCloneDescriptor.value === "function" &&
  (structuredCloneSource === "function structuredClone() {\n    [native code]\n}" ||
    structuredCloneSource === "function structuredClone() { [native code] }")
// Flatbush's actual dependency may not be importable as a root package. Capture
// its private queue class at module initialization, before caller hooks exist.
const flatQueuePrototype = getPrototype((new Flatbush(1) as unknown as { _queue: object })._queue)!
const typedArrayPrototype = getPrototype(Uint8Array.prototype)!
const typedArrayBuffer = getDescriptor(typedArrayPrototype, "buffer")!.get!
const typedArrayByteOffset = getDescriptor(typedArrayPrototype, "byteOffset")!.get!
const typedArrayByteLength = getDescriptor(typedArrayPrototype, "byteLength")!.get!
const typedArrayLength = getDescriptor(typedArrayPrototype, "length")!.get!
const typedArrayPrototypes: object[] = []
const nativeStatePrototypes = [Object.prototype, Array.prototype, null, Map.prototype, Set.prototype,
  nativeArrayBufferPrototype, DataView.prototype, ConnectivityMap.prototype, PathSimplificationGeometryIndex.prototype,
  SegmentTree.prototype, Flatbush.prototype, RBush.prototype, flatQueuePrototype, SingleSimplifiedPathSolver5.prototype]
const nativeTargets: object[] = [Object, Object.prototype, Array, Array.prototype, Math, JSON, Number, Number.prototype,
  String, String.prototype, Boolean, Boolean.prototype, BigInt, BigInt.prototype, Symbol, Symbol.prototype,
  Map, Map.prototype, Set, Set.prototype, WeakMap, WeakMap.prototype, WeakSet, WeakSet.prototype,
  Reflect, Function, Function.prototype, Atomics, Promise, Promise.prototype, Proxy,
  MultiSimplifiedPathSolver, MultiSimplifiedPathSolver.prototype, getPrototype(MultiSimplifiedPathSolver.prototype),
  SingleSimplifiedPathSolver5, SingleSimplifiedPathSolver5.prototype, getPrototype(SingleSimplifiedPathSolver5.prototype),
  ConnectivityMap, ConnectivityMap.prototype, PathSimplificationGeometryIndex, PathSimplificationGeometryIndex.prototype,
  SegmentTree, SegmentTree.prototype, Flatbush, Flatbush.prototype, RBush, RBush.prototype,
  flatQueuePrototype, getDescriptor(flatQueuePrototype, "constructor")!.value, typedArrayPrototype, getPrototype(Uint8Array),
  ParallelPathQueryCertifier, ParallelPathQueryCertifier.prototype,
  ParallelPathInputScopeGraph, ParallelPathInputScopeGraph.prototype,
  getPrototype([][Symbol.iterator]()), getPrototype(getPrototype([][Symbol.iterator]())),
  getPrototype(new Map()[Symbol.iterator]()), getPrototype(new Set()[Symbol.iterator]()), URL, URL.prototype]
const knownNativeFunctions: Function[] = []
for (let index = 0; index < globalEntries.length; index++) {
  const descriptor = globalEntries[index]!.descriptor
  if (descriptor?.data && typeof descriptor.value === "function") {
    nativeTargets.push(descriptor.value)
    knownNativeFunctions.push(descriptor.value)
    const prototypeDescriptor = getDescriptor(descriptor.value, "prototype")
    if (prototypeDescriptor && typeof prototypeDescriptor.value === "object" && prototypeDescriptor.value !== null) {
      nativeTargets.push(prototypeDescriptor.value)
      if (globalEntries[index]!.key.endsWith("Array") || globalEntries[index]!.key === "DataView") {
        nativeStatePrototypes.push(prototypeDescriptor.value)
      }
      if (globalEntries[index]!.key.endsWith("Array") && globalEntries[index]!.key !== "Array") {
        typedArrayPrototypes.push(prototypeDescriptor.value)
      }
    }
  }
}
const nativeContracts: ParallelPathPrototypeContract[] = []
const capturedTargets = new Set<object>()
for (let index = 0; index < nativeTargets.length; index++) {
  const target = nativeTargets[index]!
  if (capturedTargets.has(target)) continue
  capturedTargets.add(target)
  nativeContracts.push(captureParallelPathPrototypeContract(target))
}
const objectPrototypeContract = nativeContracts[1]!
const nativeFunctionChecks = [getDescriptor, getDescriptors, getPrototype, ownKeys, objectIs, apply, hasOwn, functionSource,
  Math.sqrt, Math.min, Math.max, Math.abs, Math.floor, Math.hypot, JSON.stringify, Number.isFinite]
  .map((value) => apply(functionSource, value, []).includes("[native code]"))
const geometryKeys = ["unsimplifiedHdRoutes", "otherHdRoutes", "obstacles", "colorMap", "outline",
  "minBoardEdgeClearance", "defaultViaDiameter", "useTraceWidthAwareClearance", "enableVertexShortcuts"]
const ownNativeHooks = ["step", "_step", "solve", "getSolverName", "tryFinalAcceptance", "computeProgress"]

// Native descriptor records inherit Object.prototype. Never read an absent
// field: a caller can install an inherited value/get/writable observer while
// changing another intrinsic. Complete private metadata has every field own.
function completeDescriptor(descriptor: PropertyDescriptor | undefined, stats?: ParallelPathEligibilityStats): CompleteDescriptor | undefined {
  if (descriptor === undefined) return undefined
  if (stats) { stats.descriptorReads++; stats.descriptorOwnFieldChecks++; stats.descriptorMetadataFieldReads += 4 }
  const data = apply(hasOwn, descriptor, ["value"])
  // Captured native reflection returns a complete data or accessor descriptor.
  // Read only the four own fields guaranteed for that kind, never optional
  // metadata inherited from Object.prototype.
  return { data, value: data ? descriptor.value : undefined,
    get: data ? undefined : descriptor.get,
    set: data ? undefined : descriptor.set,
    writable: data ? descriptor.writable : undefined,
    enumerable: descriptor.enumerable, configurable: descriptor.configurable }
}

function readOwnDescriptor(target: object, key: PropertyKey, stats?: ParallelPathEligibilityStats): CompleteDescriptor | undefined {
  if (stats) {
    stats.descriptorBuiltinCalls++
  }
  return completeDescriptor(getDescriptor(target, key), stats)
}

function descriptorMatches(actual: CompleteDescriptor | undefined, expected: CompleteDescriptor | undefined): boolean {
  if (actual === undefined || expected === undefined) return actual === expected
  return actual.data === expected.data && objectIs(actual.value, expected.value) && actual.get === expected.get &&
    actual.set === expected.set && actual.writable === expected.writable && actual.enumerable === expected.enumerable &&
    actual.configurable === expected.configurable
}

function nativeDescriptorMatches(actual: PropertyDescriptor | undefined, expected: CompleteDescriptor, stats?: ParallelPathEligibilityStats): boolean {
  if (actual === undefined) return false
  if (stats) { stats.descriptorReads++; stats.descriptorOwnFieldChecks++; stats.descriptorMetadataFieldReads += 2 }
  const data = apply(hasOwn, actual, ["value"])
  const enumerable = actual.enumerable
  const configurable = actual.configurable
  if (data !== expected.data || enumerable !== expected.enumerable || configurable !== expected.configurable) return false
  if (stats) stats.descriptorMetadataFieldReads += 2
  if (data) {
    const value = actual.value
    const writable = actual.writable
    return objectIs(value, expected.value) && writable === expected.writable
  }
  const get = actual.get
  const set = actual.set
  return get === expected.get && set === expected.set
}

export function captureParallelPathPrototypeContract(target: object, stats?: ParallelPathEligibilityStats): ParallelPathPrototypeContract {
  if (stats) { stats.descriptorBuiltinCalls++; stats.ownKeyReads++; stats.prototypeReads++ }
  const descriptors = getDescriptors(target)
  const keys = ownKeys(descriptors)
  const entries: DescriptorEntry[] = []
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!
    entries.push({ key, descriptor: completeDescriptor(descriptors[key as keyof typeof descriptors], stats)! })
  }
  return { target, prototype: getPrototype(target), entries }
}

function matchesContract(contract: ParallelPathPrototypeContract, stats?: ParallelPathEligibilityStats): boolean {
  if (stats) { stats.objectChecks++; stats.prototypeReads++ }
  if (getPrototype(contract.target) !== contract.prototype) return false
  const descriptors = getDescriptors(contract.target)
  const keys = ownKeys(descriptors)
  if (stats) { stats.ownKeyReads++; stats.descriptorBuiltinCalls++ }
  if (keys.length !== contract.entries.length) return false
  // Prove dictionary own keys before accessing any metadata property.
  for (let index = 0; index < keys.length; index++) if (keys[index] !== contract.entries[index]!.key) return false
  for (let index = 0; index < contract.entries.length; index++) {
    const entry = contract.entries[index]!
    if (!nativeDescriptorMatches(descriptors[entry.key as keyof typeof descriptors], entry.descriptor, stats)) return false
  }
  return true
}

function hasNativeObservationContract(stats?: ParallelPathEligibilityStats): boolean {
  for (let index = 0; index < nativeFunctionChecks.length; index++) if (!nativeFunctionChecks[index]) return false
  // This preflight also permits later native Array/Map helpers only after their
  // prototype metadata has been checked, without inherited getter observations.
  if (!matchesContract(objectPrototypeContract, stats)) return false
  for (let index = 0; index < globalEntries.length; index++) {
    const entry = globalEntries[index]!
    if (!descriptorMatches(readOwnDescriptor(globalThis, entry.key, stats), entry.descriptor)) return false
  }
  for (let index = 0; index < nativeContracts.length; index++) if (!matchesContract(nativeContracts[index]!, stats)) return false
  return true
}

function capturePlainDataGraph(value: unknown, stats?: ParallelPathEligibilityStats): ParallelPathPrototypeContract[] | undefined {
  const isProxy = getReferenceDrcProxyInspector()
  if (!isProxy) return undefined
  const contracts: ParallelPathPrototypeContract[] = []
  const seen = new WeakSet<object>()
  const pending: unknown[] = [value]
  while (pending.length > 0) {
    const item = pending.pop()
    if (item === null || item === undefined || typeof item === "boolean" || typeof item === "string") continue
    if (typeof item === "number") { if (!Number.isFinite(item)) return undefined; continue }
    if (typeof item !== "object" || isProxy(item)) return undefined
    if (seen.has(item)) continue
    seen.add(item)
    if (stats) stats.prototypeReads++
    const prototype = getPrototype(item)
    if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) return undefined
    const contract = captureParallelPathPrototypeContract(item, stats)
    contracts.push(contract)
    for (let index = 0; index < contract.entries.length; index++) {
      const entry = contract.entries[index]!
      const descriptor = entry.descriptor
      // Structured clone omits symbols/nonenumerable data. Keep the original
      // native continuation for graphs that cannot have the same clone input.
      if (typeof entry.key !== "string" || !descriptor.data ||
        (!descriptor.enumerable && !(prototype === Array.prototype && entry.key === "length"))) return undefined
      pending.push(descriptor.value)
    }
  }
  return contracts
}

type AwaitTypedView = { target: object; prototype: object; keys: PropertyKey[]; entries: DescriptorEntry[];
  buffer: ArrayBuffer; byteOffset: number; byteLength: number; length: number }
type AwaitStateGraph = { contracts: ParallelPathPrototypeContract[]; maps: { target: Map<unknown, unknown>; entries: unknown[] }[];
  sets: { target: Set<unknown>; values: unknown[] }[]; buffers: { target: ArrayBuffer; bytes: Uint8Array }[]; views: AwaitTypedView[] }

function captureTypedView(target: object, prototype: object, stats: ParallelPathEligibilityStats): AwaitTypedView | undefined {
  stats.awaitBufferGetterCalls += 4
  const buffer = apply(typedArrayBuffer, target, []) as ArrayBuffer
  const byteOffset = apply(typedArrayByteOffset, target, []) as number
  const byteLength = apply(typedArrayByteLength, target, []) as number
  const length = apply(typedArrayLength, target, []) as number
  stats.prototypeReads++
  if (getPrototype(buffer) !== nativeArrayBufferPrototype) return undefined
  stats.ownKeyReads++
  const keys = ownKeys(target)
  if (keys.length < length) return undefined
  // Integer-indexed exotic properties cannot be accessors or change their
  // descriptor flags. Exact native view slots and backing bytes determine all
  // their values; preserve the complete own-key order and every extra property.
  for (let index = 0; index < length; index++) if (keys[index] !== String(index)) return undefined
  const entries: DescriptorEntry[] = []
  for (let index = length; index < keys.length; index++) {
    const key = keys[index]!
    const descriptor = readOwnDescriptor(target, key, stats)!
    if (!descriptor.data) return undefined
    entries.push({ key, descriptor })
  }
  stats.awaitTypedIndexDescriptorsSkipped += length
  return { target, prototype, keys, entries, buffer, byteOffset, byteLength, length }
}

function hasNativeAwaitReceiver(target: object, prototype: object | null, stats: ParallelPathEligibilityStats): boolean {
  const getter = prototype === Map.prototype ? mapSize : prototype === Set.prototype ? setSize :
    prototype === nativeArrayBufferPrototype ? arrayBufferByteLength : undefined
  if (!getter) return true
  stats.awaitReceiverBrandChecks++
  if (prototype === nativeArrayBufferPrototype) stats.awaitBufferGetterCalls++
  // Called only after proxy and complete intrinsic validation. These exact
  // native getters can fail solely on an incompatible internal-slot receiver;
  // no routing, geometry, callback or mutable consumer is inside the probe.
  try { apply(getter, target, []); return true }
  catch (error: unknown) {
    stats.prototypeReads++
    if (getPrototype(error) !== nativeTypeErrorPrototype) throw error
    return false
  }
}

function isNativeIndexedRouteRecord(contract: ParallelPathPrototypeContract): boolean {
  const keys = ["minX", "minY", "maxX", "maxY", "route", "routeIndex", "immutable"]
  if (contract.prototype !== Object.prototype || contract.entries.length !== keys.length) return false
  for (let index = 0; index < keys.length; index++) {
    const entry = contract.entries[index]!
    if (entry.key !== keys[index] || !entry.descriptor.data) return false
    const value = entry.descriptor.value
    if (index < 4 && typeof value !== "number") return false
    if (index === 4 && (value === null || typeof value !== "object")) return false
    if (index === 5 && !Number.isInteger(value)) return false
    if (index === 6 && typeof value !== "boolean") return false
  }
  return true
}

function captureAwaitGraph(roots: unknown[], covered: WeakSet<object>, stats: ParallelPathEligibilityStats,
  scoped?: { index: object; originals: ParallelPathInputScopeGraph }): AwaitStateGraph | undefined {
  const isProxy = getReferenceDrcProxyInspector()
  if (!isProxy) return undefined
  const graph: AwaitStateGraph = { contracts: [], maps: [], sets: [], buffers: [], views: [] }
  // An index wrapper may also be aliased by a real output/control object. Its
  // opaque source edge applies only on the index traversal, never that alias.
  const seen = new WeakSet<object>(), seenIndex = new WeakSet<object>()
  const pending = roots.map((value) => ({ value, index: value === scoped?.index }))
  while (pending.length > 0) {
    const next = pending.pop()!
    const item = next.value
    if (item === null || item === undefined || typeof item === "boolean" || typeof item === "string" ||
      typeof item === "number" || typeof item === "bigint") continue
    if (typeof item === "function") { if (knownNativeFunctions.includes(item)) continue; return undefined }
    if (typeof item !== "object" || isProxy(item)) return undefined
    const visited = next.index ? seenIndex : seen
    if (visited.has(item)) continue
    visited.add(item)
    // The independently callable returned check runs complete input eligibility
    // first, including these exact identities and every reachable descriptor.
    if (covered.has(item)) { stats.awaitCoveredObjectsSkipped++; continue }
    const originalContract = scoped?.originals.original(item)
    if (originalContract) {
      // Source identities reached through actual outputs/controls retain their
      // ORIGINAL values. Capturing a fresh baseline here would hide mutation.
      if (!matchesContract(originalContract, stats)) return undefined
      graph.contracts.push(originalContract)
      stats.scopeControlOriginalObjects++
      stats.awaitSnapshotObjects++
      stats.awaitSnapshotProperties += originalContract.entries.length
      for (let index = 0; index < originalContract.entries.length; index++) {
        pending.push({ value: originalContract.entries[index]!.descriptor.value, index: false })
      }
      continue
    }
    if (stats) stats.prototypeReads++
    const prototype = getPrototype(item)
    if (!nativeStatePrototypes.includes(prototype)) return undefined
    if (!hasNativeAwaitReceiver(item, prototype, stats)) return undefined
    if (typedArrayPrototypes.includes(prototype!) && ArrayBuffer.isView(item)) {
      const view = captureTypedView(item, prototype!, stats)
      if (!view) return undefined
      graph.views.push(view)
      stats.awaitSnapshotObjects++
      stats.awaitSnapshotProperties += view.entries.length
      for (let index = 0; index < view.entries.length; index++) pending.push({ value: view.entries[index]!.descriptor.value, index: next.index })
      pending.push({ value: view.buffer, index: next.index })
      continue
    }
    const contract = captureParallelPathPrototypeContract(item, stats)
    if (scoped && next.index) {
      // Query dispatch must not call a late own shadow of an original library
      // method, even when that shadow happens to be another native function.
      for (let index = 0; index < nativeContracts.length; index++) {
        const prototypeContract = nativeContracts[index]!
        if (prototypeContract.target !== prototype) continue
        for (let entryIndex = 0; entryIndex < prototypeContract.entries.length; entryIndex++) {
          const entry = prototypeContract.entries[entryIndex]!
          if (typeof entry.descriptor.value !== "function") continue
          for (let ownIndex = 0; ownIndex < contract.entries.length; ownIndex++) {
            if (contract.entries[ownIndex]!.key === entry.key) return undefined
          }
        }
        break
      }
    }
    graph.contracts.push(contract)
    stats.awaitSnapshotObjects++
    stats.awaitSnapshotProperties += contract.entries.length
    const nativeIndexRecord = next.index && isNativeIndexedRouteRecord(contract)
    for (let index = 0; index < contract.entries.length; index++) {
      const entry = contract.entries[index]!
      const descriptor = entry.descriptor
      if (!descriptor.data) return undefined
      if (scoped && next.index && ((item === scoped.index && entry.key === "obstacles") ||
        (nativeIndexRecord && entry.key === "route"))) {
        // Native selection reads these identities and stored bounds, then only
        // the selected source geometry. Their owning containers remain shallow
        // checked; selected inputs and real output aliases are checked deeply.
        stats.scopeIndexSourceEdgesSkipped++
        continue
      }
      pending.push({ value: descriptor.value, index: next.index })
    }
    if (prototype === Map.prototype) {
      const entries: unknown[] = []
      apply(mapForEach, item, [(value: unknown, key: unknown): void => { entries.push(key, value); pending.push({ value: key, index: next.index }, { value, index: next.index }); stats.awaitMapEntriesCaptured++ }])
      graph.maps.push({ target: item as Map<unknown, unknown>, entries })
    } else if (prototype === Set.prototype) {
      const values: unknown[] = []
      apply(setForEach, item, [(value: unknown): void => { values.push(value); pending.push({ value, index: next.index }); stats.awaitSetValuesCaptured++ }])
      graph.sets.push({ target: item as Set<unknown>, values })
    } else if (prototype === nativeArrayBufferPrototype) {
      stats.awaitBufferGetterCalls++
      const length = apply(arrayBufferByteLength, item, [])
      if (arrayBufferDetached) {
        stats.awaitBufferGetterCalls++
        if (apply(arrayBufferDetached, item, [])) return undefined
      } else if (length === 0) return undefined
      const bytes = new nativeUint8Array(length)
      bytes.set(new nativeUint8Array(item as ArrayBuffer))
      stats.awaitBufferBytesCopied += length
      graph.buffers.push({ target: item as ArrayBuffer, bytes })
    } else if (ArrayBuffer.isView(item)) {
      const descriptor = readOwnDescriptor(typedArrayPrototype, "buffer", stats)
      stats.awaitBufferGetterCalls++
      const buffer = prototype === DataView.prototype ? apply(readOwnDescriptor(DataView.prototype, "buffer", stats)!.get!, item, []) :
        apply(descriptor!.get!, item, [])
      pending.push({ value: buffer, index: next.index })
    }
  }
  return graph
}

function matchesAwaitGraph(graph: AwaitStateGraph, stats: ParallelPathEligibilityStats): boolean {
  for (let index = 0; index < graph.contracts.length; index++) if (!matchesContract(graph.contracts[index]!, stats)) return false
  for (let index = 0; index < graph.maps.length; index++) {
    const row = graph.maps[index]!
    let cursor = 0
    let matches = true
    apply(mapForEach, row.target, [(value: unknown, key: unknown): void => {
      stats.awaitMapEntriesCompared++
      if (!objectIs(key, row.entries[cursor++]) || !objectIs(value, row.entries[cursor++])) matches = false
    }])
    if (!matches || cursor !== row.entries.length) return false
  }
  for (let index = 0; index < graph.sets.length; index++) {
    const row = graph.sets[index]!
    let cursor = 0
    let matches = true
    apply(setForEach, row.target, [(value: unknown): void => { stats.awaitSetValuesCompared++; if (!objectIs(value, row.values[cursor++])) matches = false }])
    if (!matches || cursor !== row.values.length) return false
  }
  for (let index = 0; index < graph.buffers.length; index++) {
    const row = graph.buffers[index]!
    stats.awaitBufferGetterCalls++
    if (apply(arrayBufferByteLength, row.target, []) !== row.bytes.length) return false
    if (arrayBufferDetached) {
      stats.awaitBufferGetterCalls++
      if (apply(arrayBufferDetached, row.target, [])) return false
    } else if (row.bytes.length === 0) return false
    const bytes = new nativeUint8Array(row.target)
    for (let byte = 0; byte < bytes.length; byte++) {
      stats.awaitBufferBytesCompared++
      if (bytes[byte] !== row.bytes[byte]) return false
    }
  }
  for (let index = 0; index < graph.views.length; index++) {
    const row = graph.views[index]!
    stats.objectChecks++
    stats.prototypeReads++
    if (getPrototype(row.target) !== row.prototype) return false
    stats.awaitBufferGetterCalls++
    if (apply(typedArrayBuffer, row.target, []) !== row.buffer) return false
    stats.awaitBufferGetterCalls++
    if (apply(typedArrayByteOffset, row.target, []) !== row.byteOffset) return false
    stats.awaitBufferGetterCalls++
    if (apply(typedArrayByteLength, row.target, []) !== row.byteLength) return false
    stats.awaitBufferGetterCalls++
    if (apply(typedArrayLength, row.target, []) !== row.length) return false
    stats.ownKeyReads++
    const keys = ownKeys(row.target)
    if (keys.length !== row.keys.length) return false
    for (let key = 0; key < keys.length; key++) if (keys[key] !== row.keys[key]) return false
    stats.awaitTypedIndexDescriptorsSkipped += row.length
    for (let property = 0; property < row.entries.length; property++) {
      const entry = row.entries[property]!
      if (!descriptorMatches(readOwnDescriptor(row.target, entry.key, stats), entry.descriptor)) return false
    }
  }
  return true
}

/** Only a factory-minted complete checker for this exact owner can replace its
 * redundant eligibility call. Captured WeakMap operations never inspect a
 * supplied callback/proxy or accept a public capability flag. */
export function isNativeParallelPathAwaitStateCheck(
  check: unknown, owner: MultiSimplifiedPathSolver, eligibility: unknown,
): boolean {
  if (typeof check !== "function") return false
  const binding = apply(weakMapGet, awaitCheckOwners, [check]) as { owner: MultiSimplifiedPathSolver; eligibility: ParallelPathLookaheadEligibility } | undefined
  return binding !== undefined && binding.owner === owner && binding.eligibility === eligibility
}

export function isOrdinaryParallelPathRoute(route: HighDensityRoute): boolean {
  if (!route || typeof route.connectionName !== "string" || !Array.isArray(route.route) || !Array.isArray(route.vias) ||
    !Number.isFinite(route.traceThickness) || !Number.isFinite(route.viaDiameter) || route.viaDiameter < 0 || route.jumpers?.length) return false
  for (let index = 0; index < route.route.length; index++) {
    const point = route.route[index]
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isInteger(point.z) ||
      point.z < 0 || point.z >= 32 || Math.abs(point.x) > 10_000 || Math.abs(point.y) > 10_000 ||
      objectIs(point.x, -0) || objectIs(point.y, -0)) return false
  }
  for (let index = 0; index < route.vias.length; index++) {
    const via = route.vias[index]
    if (!via || !Number.isFinite(via.x) || !Number.isFinite(via.y) || Math.abs(via.x) > 10_000 ||
      Math.abs(via.y) > 10_000 || objectIs(via.x, -0) || objectIs(via.y, -0)) return false
  }
  return true
}

/** Only the actual helper and owner can widen a native worker window. */
export function getNativeParallelPathLookaheadWindowCapacity(
  owner: MultiSimplifiedPathSolver, eligibility: unknown,
): number | undefined {
  if (typeof eligibility !== "function") return undefined
  const boundOwner = apply(weakMapGet, nativeEligibilityOwners, [eligibility]) as MultiSimplifiedPathSolver | undefined
  if (boundOwner !== owner) return undefined
  return nativeLookaheadWindowCapacity
}

/** Exact owned phase snapshots, original native methods, and no observable hooks. */
export function createParallelPathLookaheadEligibility(
  solver: MultiSimplifiedPathSolver,
  ownerContract: ParallelPathPrototypeContract,
): ParallelPathLookaheadEligibility | undefined {
  const stats: ParallelPathEligibilityStats = { checks: 0, objectChecks: 0, ownKeyReads: 0, descriptorReads: 0, descriptorBuiltinCalls: 0,
    descriptorMetadataFieldReads: 0, descriptorOwnFieldChecks: 0, prototypeReads: 0, snapshotObjects: 0, snapshotProperties: 0,
    awaitCaptures: 0, awaitChecks: 0, awaitSnapshotObjects: 0, awaitSnapshotProperties: 0, awaitMapEntriesCaptured: 0,
    awaitMapEntriesCompared: 0, awaitSetValuesCaptured: 0, awaitSetValuesCompared: 0, awaitBufferBytesCopied: 0,
    awaitBufferBytesCompared: 0, awaitBufferGetterCalls: 0, awaitCoveredObjectsSkipped: 0, awaitTypedIndexDescriptorsSkipped: 0,
    awaitReceiverBrandChecks: 0, scopeCaptures: 0, scopeChecks: 0, scopeObjects: 0, scopeProperties: 0,
    scopeIndexSourceEdgesSkipped: 0, scopeControlOriginalObjects: 0 }
  const isProxy = getReferenceDrcProxyInspector()
  if (!hasNativeSharedBuffer || !hasNativeStructuredClone || !isProxy || isProxy(structuredCloneDescriptor!.value) ||
    isProxy(solver) || !hasNativeObservationContract(stats) || !matchesContract(ownerContract, stats) ||
    (stats.prototypeReads++, getPrototype(solver)) !== ownerContract.target) return undefined
  const snapshots: DescriptorEntry[] = []
  const geometry: Record<string, unknown> = {}
  for (let index = 0; index < geometryKeys.length; index++) {
    const key = geometryKeys[index]!
    const descriptor = readOwnDescriptor(solver, key, stats)
    if (!descriptor || !descriptor.data) return undefined
    snapshots.push({ key, descriptor })
    geometry[key] = descriptor.value
  }
  for (let hookIndex = 0; hookIndex < ownNativeHooks.length; hookIndex++) {
    const key = ownNativeHooks[hookIndex]!
    if (readOwnDescriptor(solver, key, stats)) return undefined
  }
  const connDescriptor = readOwnDescriptor(solver, "connMap", stats)
  const capDescriptor = readOwnDescriptor(solver, "MAX_ITERATIONS", stats)
  if (!connDescriptor || !connDescriptor.data || !capDescriptor || !capDescriptor.data ||
    capDescriptor.value !== 100_000_000 || geometry.useTraceWidthAwareClearance !== false || geometry.enableVertexShortcuts !== false) return undefined
  const connMap: unknown = connDescriptor.value
  if (typeof connMap !== "object" || connMap === null || isProxy(connMap) || (stats.prototypeReads++, getPrototype(connMap)) !== ConnectivityMap.prototype) return undefined
  const connValues: Record<string, unknown> = {}
  stats.ownKeyReads++
  const connKeys = ownKeys(connMap)
  for (let index = 0; index < connKeys.length; index++) {
    const key = connKeys[index]!
    if (typeof key !== "string") return undefined
    const descriptor = readOwnDescriptor(connMap, key, stats)
    if (!descriptor || !descriptor.data) return undefined
    connValues[key] = descriptor.value
  }
  const geometryContracts = capturePlainDataGraph(geometry, stats)
  const connectionContracts = capturePlainDataGraph(connValues, stats)
  if (!geometryContracts || !connectionContracts) return undefined
  const connectionRootContract = captureParallelPathPrototypeContract(connMap, stats)
  const indexDescriptor = readOwnDescriptor(solver, "geometryIndex", stats)
  if (!indexDescriptor?.data || typeof indexDescriptor.value !== "object" || indexDescriptor.value === null ||
    isProxy(indexDescriptor.value) || getPrototype(indexDescriptor.value) !== PathSimplificationGeometryIndex.prototype) return undefined
  const nativeIndex = indexDescriptor.value as PathSimplificationGeometryIndex
  const indexRootContract = captureParallelPathPrototypeContract(nativeIndex, stats)
  const inputScopeGraph = new ParallelPathInputScopeGraph([...geometryContracts, ...connectionContracts, connectionRootContract])
  const coveredControlObjects = new WeakSet<object>()
  coveredControlObjects.add(connMap)
  for (let index = 0; index < geometryContracts.length; index++) coveredControlObjects.add(geometryContracts[index]!.target)
  for (let index = 0; index < connectionContracts.length; index++) coveredControlObjects.add(connectionContracts[index]!.target)
  const initialIndexState = captureAwaitGraph([nativeIndex], coveredControlObjects, stats,
    { index: nativeIndex, originals: inputScopeGraph })
  if (!initialIndexState) return undefined
  const routes = geometry.unsimplifiedHdRoutes as HighDensityRoute[]
  const otherRoutes = geometry.otherHdRoutes as HighDensityRoute[]
  if (!Array.isArray(routes) || !Array.isArray(otherRoutes)) return undefined
  for (let index = 0; index < routes.length; index++) if (!isOrdinaryParallelPathRoute(routes[index]!)) return undefined
  for (let index = 0; index < otherRoutes.length; index++) if (!isOrdinaryParallelPathRoute(otherRoutes[index]!)) return undefined
  stats.snapshotObjects = geometryContracts.length + connectionContracts.length + 1
  stats.snapshotProperties = geometryContracts.reduce((count, contract) => count + contract.entries.length, 0) +
    connectionContracts.reduce((count, contract) => count + contract.entries.length, 0) + connectionRootContract.entries.length
  const containerContracts: ParallelPathPrototypeContract[] = []
  for (const value of [routes, otherRoutes, geometry.obstacles]) {
    const contract = inputScopeGraph.original(value as object)
    if (!contract) return undefined
    containerContracts.push(contract)
  }
  const essentialScope = inputScopeGraph.collect([geometry.colorMap, geometry.outline, connMap], (): undefined => undefined)
  if (!essentialScope) return undefined
  const prerequisites = (): boolean => {
    if (!hasNativeObservationContract(stats) || !matchesContract(ownerContract, stats) || (stats.prototypeReads++, getPrototype(solver)) !== ownerContract.target) return false
    const cap = readOwnDescriptor(solver, "MAX_ITERATIONS", stats)
    const map = readOwnDescriptor(solver, "connMap", stats)
    if (!cap || !cap.data || cap.value !== capDescriptor.value || !map || !map.data || map.value !== connMap) return false
    for (let hookIndex = 0; hookIndex < ownNativeHooks.length; hookIndex++) {
      const key = ownNativeHooks[hookIndex]!
      if (readOwnDescriptor(solver, key, stats)) return false
    }
    for (let index = 0; index < snapshots.length; index++) {
      const entry = snapshots[index]!
      const actual = readOwnDescriptor(solver, entry.key, stats)
      if (!actual || !actual.data || !objectIs(actual.value, entry.descriptor.value)) return false
    }
    if (!descriptorMatches(readOwnDescriptor(solver, "geometryIndex", stats), indexDescriptor)) return false
    if (!matchesContract(indexRootContract, stats)) return false
    const outputDescriptor = readOwnDescriptor(solver, "simplifiedHdRoutes", stats)
    if (!outputDescriptor?.data || typeof outputDescriptor.value !== "object" || outputDescriptor.value === null ||
      isProxy(outputDescriptor.value) || getPrototype(outputDescriptor.value) !== Array.prototype) return false
    const outputLength = readOwnDescriptor(outputDescriptor.value, "length", stats)
    if (!outputLength?.data || typeof outputLength.value !== "number") return false
    // The original phase cannot mutate the index before first publication.
    // After publication, closed native spans and each awaited control snapshot
    // retain its evolving structure; never accept a caller's pre-launch edit.
    if (outputLength.value === 0 && !matchesAwaitGraph(initialIndexState, stats)) return false
    if (!matchesContract(connectionRootContract, stats)) return false
    return true
  }
  const scopedPrerequisites = (): boolean => {
    if (!prerequisites()) return false
    for (let index = 0; index < containerContracts.length; index++) if (!matchesContract(containerContracts[index]!, stats)) return false
    for (let index = 0; index < essentialScope.contracts.length; index++) if (!matchesContract(essentialScope.contracts[index]!, stats)) return false
    return true
  }
  const eligibility = (): boolean => {
    stats.checks++
    if (!prerequisites()) return false
    for (let index = 0; index < geometryContracts.length; index++) if (!matchesContract(geometryContracts[index]!, stats)) return false
    for (let index = 0; index < connectionContracts.length; index++) if (!matchesContract(connectionContracts[index]!, stats)) return false
    return true
  }
  const captureScope = (indexes: readonly number[]): (() => boolean) | undefined => {
    stats.scopeCaptures++
    if (!scopedPrerequisites() || isProxy(indexes) || getPrototype(indexes) !== Array.prototype) return undefined
    const indexList = captureParallelPathPrototypeContract(indexes, stats)
    if (indexList.entries.length !== indexes.length + 1 || indexes.length < 1 || indexes.length > nativeLookaheadWindowCapacity) return undefined
    for (let position = 0; position < indexes.length; position++) {
      const entry = indexList.entries[position]!
      if (entry.key !== String(position) || !entry.descriptor.data || !Number.isSafeInteger(entry.descriptor.value) ||
        (entry.descriptor.value as number) < 0 || (entry.descriptor.value as number) >= routes.length ||
        (position > 0 && (entry.descriptor.value as number) <= (indexList.entries[position - 1]!.descriptor.value as number))) return undefined
    }
    // Selection invokes only original index methods over a fully inspected
    // structure. Source pointer edges are opaque here; selected rows are then
    // checked against the ORIGINAL graph before any live geometry read.
    const indexState = captureAwaitGraph([nativeIndex], coveredControlObjects, stats, { index: nativeIndex, originals: inputScopeGraph })
    if (!indexState) return undefined
    const roots: unknown[] = []
    for (let position = 0; position < indexes.length; position++) {
      const routeIndex = indexList.entries[position]!.descriptor.value as number
      const route = routes[routeIndex]!
      const inputScope = inputScopeGraph.collect([route], (): undefined => undefined)
      if (!inputScope) return undefined
      for (let index = 0; index < inputScope.contracts.length; index++) if (!matchesContract(inputScope.contracts[index]!, stats)) return undefined
      roots.push(route)
      if (route.route.length <= 1) continue
      const bounds = route.route.reduce((acc, point) => ({ minX: Math.min(acc.minX, point.x), minY: Math.min(acc.minY, point.y),
        maxX: Math.max(acc.maxX, point.x), maxY: Math.max(acc.maxY, point.y) }),
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
      const centerX = (bounds.minX + bounds.maxX) / 2, centerY = (bounds.minY + bounds.maxY) / 2
      const width = bounds.maxX - bounds.minX, height = bounds.maxY - bounds.minY
      const obstacleBounds = { minX: centerX - width / 2, minY: centerY - height / 2,
        maxX: centerX + width / 2, maxY: centerY + height / 2 }
      let candidateRoutes: HighDensityRoute[], candidateObstacles: unknown[]
      try {
        candidateRoutes = nativeIndex.getCandidateRoutes(bounds, 0.1 + 0.15, routeIndex)
        candidateObstacles = nativeIndex.getCandidateObstacles(obstacleBounds, 0.1 + 0.15 / 2)
      } catch {
        // These are extra speculative selection calls, not the native ordered
        // constructor. Withdraw and let the actual owner execute/throw at the
        // original target; descriptor, solver and protocol failures stay loud.
        return undefined
      }
      for (let index = 0; index < candidateRoutes.length; index++) roots.push(candidateRoutes[index])
      for (let index = 0; index < candidateObstacles.length; index++) roots.push(candidateObstacles[index])
    }
    const scope = inputScopeGraph.collect(roots, (target): ParallelPathPrototypeContract | undefined => {
      if (isProxy(target)) return undefined
      const prototype = getPrototype(target)
      if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) return undefined
      return captureParallelPathPrototypeContract(target, stats)
    })
    if (!scope) return undefined
    for (let index = 0; index < scope.contracts.length; index++) if (!matchesContract(scope.contracts[index]!, stats)) return undefined
    // Complete connection/outline/color contracts are prerequisites on every
    // call, so their aliases need not be scanned again through owner controls.
    for (let index = 0; index < essentialScope.contracts.length; index++) scope.covered.add(essentialScope.contracts[index]!.target)
    stats.scopeObjects += scope.contracts.length
    for (let index = 0; index < scope.contracts.length; index++) stats.scopeProperties += scope.contracts[index]!.entries.length
    const check = (): boolean => {
      stats.scopeChecks++
      if (!scopedPrerequisites() || !matchesAwaitGraph(indexState, stats)) return false
      for (let index = 0; index < scope.contracts.length; index++) if (!matchesContract(scope.contracts[index]!, stats)) return false
      return true
    }
    apply(weakMapSet, scopeCheckOwners, [check, { owner: solver, eligibility, contracts: scope.contracts, covered: scope.covered, indexState }])
    return check
  }
  const captureAwaitState = (scopeCheck?: () => boolean): (() => boolean) | undefined => {
    stats.awaitCaptures++
    if (!hasNativeObservationContract(stats) || !matchesContract(ownerContract, stats) || (stats.prototypeReads++, getPrototype(solver)) !== ownerContract.target) return undefined
    const scope = typeof scopeCheck === "function" ? apply(weakMapGet, scopeCheckOwners, [scopeCheck]) as ScopeBinding | undefined : undefined
    if (scopeCheck && (!scope || scope.owner !== solver || scope.eligibility !== eligibility)) return undefined
    const ownerState = captureParallelPathPrototypeContract(solver, stats)
    stats.awaitSnapshotObjects++
    stats.awaitSnapshotProperties += ownerState.entries.length
    const roots: unknown[] = []
    for (let index = 0; index < ownerState.entries.length; index++) {
      const entry = ownerState.entries[index]!
      if (!entry.descriptor.data) return undefined
      if (entry.key === "simplifiedHdRoutes" || entry.key === "activeSubSolver" || entry.key === "geometryIndex" || entry.key === "stats" || entry.key === "failedSubSolvers") roots.push(entry.descriptor.value)
    }
    const graph = captureAwaitGraph(roots, scope ? scope.covered : coveredControlObjects, stats,
      scope ? { index: nativeIndex, originals: inputScopeGraph } : undefined)
    if (!graph) return undefined
    const check = (): boolean => {
      stats.awaitChecks++
      // Input snapshots skipped during control capture are checked completely
      // here, even for callers that have not invoked eligibility separately.
      if (!(scopeCheck ? scopeCheck() : eligibility()) || !matchesContract(ownerState, stats)) return false
      return matchesAwaitGraph(graph, stats)
    }
    apply(weakMapSet, awaitCheckOwners, [check, { owner: solver, eligibility }])
    return check
  }
  apply(weakMapSet, nativeEligibilityOwners, [eligibility, solver])
  return Object.assign(eligibility, { stats, captureAwaitState, captureScope })
}
