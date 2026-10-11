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
  awaitBufferBytesCopied: number; awaitBufferBytesCompared: number; awaitBufferGetterCalls: number }
export type ParallelPathLookaheadEligibility = (() => boolean) & {
  stats: ParallelPathEligibilityStats
  /** Capture after intentional owner bookkeeping writes and before awaiting. */
  captureAwaitState(): (() => boolean) | undefined
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
const globals = ["Object", "Array", "Math", "JSON", "Number", "String", "Boolean", "BigInt", "Symbol", "Map", "Set",
  "WeakMap", "WeakSet", "Reflect", "Function", "Atomics", "Promise", "Proxy", "isNaN", "isFinite", "parseInt", "parseFloat",
  "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array",
  "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array", "ArrayBuffer", "SharedArrayBuffer", "DataView",
  "Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "URL", "Worker"]
const globalEntries = globals.map((key) => ({ key, descriptor: completeDescriptor(getDescriptor(globalThis, key)) }))
const sharedBufferDescriptor = globalEntries.find((entry) => entry.key === "SharedArrayBuffer")!.descriptor
const hasNativeSharedBuffer = sharedBufferDescriptor?.data && typeof sharedBufferDescriptor.value === "function"
// Flatbush's actual dependency may not be importable as a root package. Capture
// its private queue class at module initialization, before caller hooks exist.
const flatQueuePrototype = getPrototype((new Flatbush(1) as unknown as { _queue: object })._queue)!
const typedArrayPrototype = getPrototype(Uint8Array.prototype)!
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
  if (stats) { stats.descriptorReads++; stats.descriptorOwnFieldChecks += 4; stats.descriptorMetadataFieldReads += 4 }
  const data = apply(hasOwn, descriptor, ["value"])
  return { data, value: data ? descriptor.value : undefined,
    get: apply(hasOwn, descriptor, ["get"]) ? descriptor.get : undefined,
    set: apply(hasOwn, descriptor, ["set"]) ? descriptor.set : undefined,
    writable: apply(hasOwn, descriptor, ["writable"]) ? descriptor.writable : undefined,
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
    if (!descriptorMatches(completeDescriptor(descriptors[entry.key as keyof typeof descriptors], stats), entry.descriptor)) return false
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
      const descriptor = contract.entries[index]!.descriptor
      if (!descriptor.data) return undefined
      pending.push(descriptor.value)
    }
  }
  return contracts
}

type AwaitStateGraph = { contracts: ParallelPathPrototypeContract[]; maps: { target: Map<unknown, unknown>; entries: unknown[] }[];
  sets: { target: Set<unknown>; values: unknown[] }[]; buffers: { target: ArrayBuffer; bytes: Uint8Array }[] }

function captureAwaitGraph(roots: unknown[], stats: ParallelPathEligibilityStats): AwaitStateGraph | undefined {
  const isProxy = getReferenceDrcProxyInspector()
  if (!isProxy) return undefined
  const graph: AwaitStateGraph = { contracts: [], maps: [], sets: [], buffers: [] }
  const seen = new WeakSet<object>()
  const pending = roots.slice()
  while (pending.length > 0) {
    const item = pending.pop()
    if (item === null || item === undefined || typeof item === "boolean" || typeof item === "string" ||
      typeof item === "number" || typeof item === "bigint") continue
    if (typeof item === "function") { if (knownNativeFunctions.includes(item)) continue; return undefined }
    if (typeof item !== "object" || isProxy(item)) return undefined
    if (seen.has(item)) continue
    seen.add(item)
    if (stats) stats.prototypeReads++
    const prototype = getPrototype(item)
    if (!nativeStatePrototypes.includes(prototype)) return undefined
    const contract = captureParallelPathPrototypeContract(item, stats)
    graph.contracts.push(contract)
    stats.awaitSnapshotObjects++
    stats.awaitSnapshotProperties += contract.entries.length
    for (let index = 0; index < contract.entries.length; index++) {
      const descriptor = contract.entries[index]!.descriptor
      if (!descriptor.data) return undefined
      pending.push(descriptor.value)
    }
    if (prototype === Map.prototype) {
      const entries: unknown[] = []
      apply(mapForEach, item, [(value: unknown, key: unknown): void => { entries.push(key, value); pending.push(key, value); stats.awaitMapEntriesCaptured++ }])
      graph.maps.push({ target: item as Map<unknown, unknown>, entries })
    } else if (prototype === Set.prototype) {
      const values: unknown[] = []
      apply(setForEach, item, [(value: unknown): void => { values.push(value); pending.push(value); stats.awaitSetValuesCaptured++ }])
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
      pending.push(buffer)
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
  return true
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

/** Exact owned phase snapshots, original native methods, and no observable hooks. */
export function createParallelPathLookaheadEligibility(
  solver: MultiSimplifiedPathSolver,
  ownerContract: ParallelPathPrototypeContract,
): ParallelPathLookaheadEligibility | undefined {
  const stats: ParallelPathEligibilityStats = { checks: 0, objectChecks: 0, ownKeyReads: 0, descriptorReads: 0, descriptorBuiltinCalls: 0,
    descriptorMetadataFieldReads: 0, descriptorOwnFieldChecks: 0, prototypeReads: 0, snapshotObjects: 0, snapshotProperties: 0,
    awaitCaptures: 0, awaitChecks: 0, awaitSnapshotObjects: 0, awaitSnapshotProperties: 0, awaitMapEntriesCaptured: 0,
    awaitMapEntriesCompared: 0, awaitSetValuesCaptured: 0, awaitSetValuesCompared: 0, awaitBufferBytesCopied: 0,
    awaitBufferBytesCompared: 0, awaitBufferGetterCalls: 0 }
  const isProxy = getReferenceDrcProxyInspector()
  if (!hasNativeSharedBuffer || !isProxy || isProxy(solver) || !hasNativeObservationContract(stats) || !matchesContract(ownerContract, stats) ||
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
  const routes = geometry.unsimplifiedHdRoutes as HighDensityRoute[]
  const otherRoutes = geometry.otherHdRoutes as HighDensityRoute[]
  if (!Array.isArray(routes) || !Array.isArray(otherRoutes)) return undefined
  for (let index = 0; index < routes.length; index++) if (!isOrdinaryParallelPathRoute(routes[index]!)) return undefined
  for (let index = 0; index < otherRoutes.length; index++) if (!isOrdinaryParallelPathRoute(otherRoutes[index]!)) return undefined
  stats.snapshotObjects = geometryContracts.length + connectionContracts.length + 1
  stats.snapshotProperties = geometryContracts.reduce((count, contract) => count + contract.entries.length, 0) +
    connectionContracts.reduce((count, contract) => count + contract.entries.length, 0) + connectionRootContract.entries.length
  const eligibility = (): boolean => {
    stats.checks++
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
    if (!matchesContract(connectionRootContract, stats)) return false
    for (let index = 0; index < geometryContracts.length; index++) if (!matchesContract(geometryContracts[index]!, stats)) return false
    for (let index = 0; index < connectionContracts.length; index++) if (!matchesContract(connectionContracts[index]!, stats)) return false
    return true
  }
  const captureAwaitState = (): (() => boolean) | undefined => {
    stats.awaitCaptures++
    if (!hasNativeObservationContract(stats) || !matchesContract(ownerContract, stats) || (stats.prototypeReads++, getPrototype(solver)) !== ownerContract.target) return undefined
    const ownerState = captureParallelPathPrototypeContract(solver, stats)
    stats.awaitSnapshotObjects++
    stats.awaitSnapshotProperties += ownerState.entries.length
    const roots: unknown[] = []
    for (let index = 0; index < ownerState.entries.length; index++) {
      const entry = ownerState.entries[index]!
      if (!entry.descriptor.data) return undefined
      if (entry.key === "simplifiedHdRoutes" || entry.key === "activeSubSolver" || entry.key === "geometryIndex" || entry.key === "stats" || entry.key === "failedSubSolvers") roots.push(entry.descriptor.value)
    }
    const graph = captureAwaitGraph(roots, stats)
    if (!graph) return undefined
    return (): boolean => {
      stats.awaitChecks++
      // Safe when called independently too; the owner driver can avoid a second
      // full check only through a private immediately checked synchronous span.
      if (!hasNativeObservationContract(stats) || !matchesContract(ownerState, stats)) return false
      return matchesAwaitGraph(graph, stats)
    }
  }
  return Object.assign(eligibility, { stats, captureAwaitState })
}
