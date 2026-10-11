import { PcbConnectivityMap } from "circuit-json-to-connectivity-map"
import { getReferenceDrcProxyInspector } from "./authoritative-drc-fork/initializeReferenceDrcRuntime"
import { assertNativeSourceAliasOutput } from "./nativeSourceAliasProvenance"
import type { ParallelReferenceContinuityBatch, ParallelReferenceContinuityBatchResult, ParallelReferenceContinuityContext, ParallelReferenceContinuitySourceRows, ParallelReferenceContinuityTask } from "./parallelReferenceContinuityTypes"

const getOwnDescriptor = Object.getOwnPropertyDescriptor
const getPrototypeOf = Object.getPrototypeOf
const applyNative = Reflect.apply
const hasOwn = Object.prototype.hasOwnProperty
const isView = ArrayBuffer.isView
const isSafeInteger = Number.isSafeInteger
const isArray = Array.isArray
const ceil = Math.ceil
const maximumSafeInteger = Number.MAX_SAFE_INTEGER
const objectPrototype = Object.prototype
const uint32Prototype = Uint32Array.prototype
const Uint32 = Uint32Array
const NativeSet = Set
const setHas = Set.prototype.has
const setAdd = Set.prototype.add
const typedPrototype = getPrototypeOf(uint32Prototype)
const typedLength = getOwnDescriptor(typedPrototype, "length")!.get!
const nativeTracePair = PcbConnectivityMap.prototype._arePcbTracesConnected
const MAX_ITEMS = 4_000_000

export class ParallelReferenceContinuityProtocolError extends Error {
  constructor(message: string) { super(message); this.name = "ParallelReferenceContinuityProtocolError" }
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ParallelReferenceContinuityProtocolError(message)
}

function ownValue(object: object, key: string): unknown {
  const descriptor = getOwnDescriptor(object, key)
  invariant(descriptor !== undefined && applyNative(hasOwn, descriptor, ["value"]), `Expected own data field ${key}`)
  return descriptor.value
}

function plainObject(value: unknown): asserts value is object {
  const inspector = getReferenceDrcProxyInspector()
  invariant(inspector !== undefined, "Reference runtime capability is uninitialized")
  invariant((typeof value === "object" && value !== null) && !inspector(value), "Expected non-proxy object")
  invariant(getPrototypeOf(value) === objectPrototype || getPrototypeOf(value) === null, "Expected plain record")
}

function uint32View(value: unknown): { view: Uint32Array; length: number } {
  const inspector = getReferenceDrcProxyInspector()
  invariant(inspector !== undefined, "Reference runtime capability is uninitialized")
  invariant(typeof value === "object" && value !== null && !inspector(value), "Expected non-proxy Uint32Array")
  invariant(isView(value) && getPrototypeOf(value) === uint32Prototype, "Expected Uint32Array")
  const fields = ["buffer", "length", "byteLength", "byteOffset"]
  for (let i = 0; i < fields.length; i++) invariant(getOwnDescriptor(value, fields[i]!) === undefined, "Prepared view shadows native storage")
  const length = applyNative(typedLength, value, []) as number
  invariant(length <= MAX_ITEMS, "Prepared view exceeds resource domain")
  return { view: value as Uint32Array, length }
}

function index(value: unknown, maximum: number, name: string): asserts value is number {
  invariant(typeof value === "number" && isSafeInteger(value) && value >= 0 && value < maximum, `Invalid ${name}`)
}

/** Validates immutable transport data without invoking shadowing accessors. */
export function assertParallelReferenceContinuityContext(context: unknown): asserts context is ParallelReferenceContinuityContext {
  plainObject(context)
  index(ownValue(context, "snapshotId"), maximumSafeInteger, "snapshotId")
  const traceCount = ownValue(context, "traceCount"), portCount = ownValue(context, "portCount")
  index(traceCount, MAX_ITEMS, "traceCount"); index(portCount, MAX_ITEMS, "portCount")
  const offsets = uint32View(ownValue(context, "componentOffsets"))
  const members = uint32View(ownValue(context, "componentTraceIndexes"))
  const touched = uint32View(ownValue(context, "touchedPortWords"))
  invariant(offsets.length > 0 && offsets.view[0] === 0 && offsets.view[offsets.length - 1] === members.length, "Invalid component offsets")
  for (let i = 1; i < offsets.length; i++) invariant(offsets.view[i]! >= offsets.view[i - 1]!, "Component offsets are unordered")
  for (let i = 0; i < members.length; i++) index(members.view[i], traceCount, "component trace index")
  invariant(touched.length === traceCount * ceil(portCount / 32), "Touched-port layout differs from context")
  const geometry = getOwnDescriptor(context, "geometryTraces")
  if (geometry !== undefined) {
    invariant(applyNative(hasOwn, geometry, ["value"]), "Expected own geometry data")
    assertNativeSourceAliasOutput(geometry.value, [])
    invariant(isArray(geometry.value), "Expected geometry trace array")
  }
}

/** This preparation consumes no native memo operations or circuit mutations. */
export function prepareParallelReferenceContinuityContext(source: ParallelReferenceContinuitySourceRows): ParallelReferenceContinuityContext {
  assertNativeSourceAliasOutput(source, [])
  index(source.snapshotId, maximumSafeInteger, "snapshotId")
  index(source.portCount, MAX_ITEMS, "portCount")
  invariant(isArray(source.tracePortOrdinals) && isArray(source.components), "Expected source row arrays")
  index(source.tracePortOrdinals.length, MAX_ITEMS, "source trace count")
  const wordsPerTrace = ceil(source.portCount / 32)
  invariant(source.tracePortOrdinals.length * wordsPerTrace <= MAX_ITEMS && source.components.length < MAX_ITEMS, "Prepared snapshot exceeds resource domain")
  const touchedPortWords = new Uint32(source.tracePortOrdinals.length * wordsPerTrace)
  for (let trace = 0; trace < source.tracePortOrdinals.length; trace++) {
    invariant(isArray(source.tracePortOrdinals[trace]), "Expected touched-port row")
    for (let i = 0; i < source.tracePortOrdinals[trace]!.length; i++) {
      const ordinal: number = source.tracePortOrdinals[trace]![i]!
      index(ordinal, source.portCount, "port ordinal")
      const slot = trace * wordsPerTrace + (ordinal >>> 5)
      touchedPortWords[slot] = touchedPortWords[slot]! | (1 << (ordinal & 31))
    }
  }
  const componentOffsets = new Uint32(source.components.length + 1)
  let length = 0
  for (let i = 0; i < source.components.length; i++) {
    invariant(isArray(source.components[i]), "Expected component member array")
    length += source.components[i]!.length
    invariant(length <= MAX_ITEMS, "Component snapshot exceeds resource domain")
    componentOffsets[i + 1] = length
  }
  const componentTraceIndexes = new Uint32(length)
  let position = 0
  for (let i = 0; i < source.components.length; i++) {
    const component = source.components[i]!
    for (let j = 0; j < component.length; j++) {
      const trace = component[j]!
      index(trace, source.tracePortOrdinals.length, "source trace index")
      componentTraceIndexes[position++] = trace
    }
  }
  const context: ParallelReferenceContinuityContext = {
    snapshotId: source.snapshotId, traceCount: source.tracePortOrdinals.length, portCount: source.portCount,
    componentOffsets, componentTraceIndexes, touchedPortWords,
    ...(source.geometryTraces === undefined ? {} : { geometryTraces: source.geometryTraces }),
  }
  assertParallelReferenceContinuityContext(context)
  return context
}

/**
 * Pure facts only within the existing private checker's native-runtime guard.
 * This is not an executor for arbitrary externally supplied or mutable inputs.
 * Native memo consumption and error publication remain on main; a native
 * predicate exception is materialized again at its original main miss site.
 */
export function executeParallelReferenceContinuityBatch(batch: ParallelReferenceContinuityBatch): ParallelReferenceContinuityBatchResult {
  plainObject(batch)
  invariant(ownValue(batch, "kind") === "referenceContinuityFacts", "Unknown pure batch kind")
  const context = ownValue(batch, "context")
  assertParallelReferenceContinuityContext(context)
  const tasks = ownValue(batch, "tasks")
  assertNativeSourceAliasOutput(tasks, [])
  invariant(isArray(tasks), "Expected pure task array")
  const wordsPerTrace = ceil(context.portCount / 32)
  let pairPredicate: PcbConnectivityMap | undefined
  const rows = new NativeSet<number>()
  const facts: ParallelReferenceContinuityBatchResult["facts"] = []
  for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
    const task = tasks[taskIndex]!
    plainObject(task)
    const row = ownValue(task, "rowIndex")
    index(row, MAX_ITEMS, "rowIndex")
    invariant(!applyNative(setHas, rows, [row]), "Duplicate task row")
    applyNative(setAdd, rows, [row])
    const kind = ownValue(task, "kind")
    let value = false, consumedVisits = 0
    if (kind === "port-connectivity") {
      const component = ownValue(task, "componentIndex"), port = ownValue(task, "portOrdinal")
      index(component, context.componentOffsets.length - 1, "componentIndex")
      index(port, context.portCount, "portOrdinal")
      for (let i = context.componentOffsets[component]!; i < context.componentOffsets[component + 1]!; i++) {
        const trace = context.componentTraceIndexes[i]!
        consumedVisits++
        if ((context.touchedPortWords[trace * wordsPerTrace + (port >>> 5)]! & (1 << (port & 31))) !== 0) { value = true; break }
      }
    } else {
      invariant(kind === "native-trace-pair-miss", "Unknown pure task kind")
      const traces = context.geometryTraces
      invariant(traces !== undefined, "Geometry miss task has no original trace snapshot")
      const left = ownValue(task, "leftTraceIndex"), right = ownValue(task, "rightTraceIndex")
      index(left, traces.length, "leftTraceIndex"); index(right, traces.length, "rightTraceIndex")
      pairPredicate ??= new PcbConnectivityMap()
      try {
        value = applyNative(nativeTracePair, pairPredicate, [traces[left], traces[right]]) as boolean
      } catch (error) {
        if (!(error instanceof Error)) throw new ParallelReferenceContinuityProtocolError("Native geometry threw a non-error value")
        facts.push({ status: "exception", kind: "native-trace-pair-miss", rowIndex: row, consumedVisits: 1,
          exception: { name: error.name, message: error.message, ...(error.stack === undefined ? {} : { stack: error.stack }) } })
        continue
      }
      consumedVisits = 1
    }
    facts.push({ status: "evaluated", rowIndex: row, kind: kind as ParallelReferenceContinuityTask["kind"], value, consumedVisits })
  }
  return { kind: "referenceContinuityFacts", snapshotId: context.snapshotId, facts }
}
