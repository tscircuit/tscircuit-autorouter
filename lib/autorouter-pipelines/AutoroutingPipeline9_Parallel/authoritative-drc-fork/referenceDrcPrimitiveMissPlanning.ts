import { ReferenceDrcPrimitiveMemo, type ReferenceDrcPrimitiveMissPlan, type ReferenceDrcPrimitiveMissRow } from "./ReferenceDrcPrimitiveMemo"
import { getReferenceDrcProxyInspector } from "./initializeReferenceDrcRuntime"
import { isPrivatelyOwnedReferenceDrcPrimitiveMemo } from "./native/lib/check-traces-are-contiguous/check-traces-are-contiguous"

const getOwnDescriptor = Object.getOwnPropertyDescriptor
const getPrototypeOf = Object.getPrototypeOf
const getOwnNames = Object.getOwnPropertyNames
const getOwnSymbols = Object.getOwnPropertySymbols
const hasOwn = Object.prototype.hasOwnProperty
const applyNative = Reflect.apply
const isArray = Array.isArray
const objectIs = Object.is
const objectPrototype = Object.prototype
const arrayPrototype = Array.prototype
const nativePrepare = getOwnDescriptor(ReferenceDrcPrimitiveMemo.prototype, "prepareMissPlan")!.value as (rows: readonly ReferenceDrcPrimitiveMissRow[]) => ReferenceDrcPrimitiveMissPlan
const intrinsicOwners: readonly [object, readonly PropertyKey[]][] = [
  [Object, ["is", "getPrototypeOf", "getOwnPropertyNames", "getOwnPropertySymbols", "getOwnPropertyDescriptor"]],
  [Array, ["isArray"]], [JSON, ["stringify"]],
  [Array.prototype, ["map", "push", "values", Symbol.iterator]],
  [Object.prototype, ["hasOwnProperty"]],
  [Map.prototype, ["keys", "has", "get", "set", "delete", "size"]],
  [Set.prototype, ["keys", "has", "add", "delete"]],
  [getPrototypeOf(new Map().keys()), ["next"]],
  [getPrototypeOf(new Set().keys()), ["next"]],
  [getPrototypeOf([][Symbol.iterator]()), ["next"]],
  [ReferenceDrcPrimitiveMemo.prototype, ["constructor", "intern", "getOrCompute", "prepareMissPlan"]],
  [globalThis, ["Object", "Array", "JSON", "String", "Map", "Set"]],
]
const baseline: { owner: object; key: PropertyKey; descriptor: PropertyDescriptor }[] = []
for (let i = 0; i < intrinsicOwners.length; i++) {
  const [owner, names] = intrinsicOwners[i]!
  for (let j = 0; j < names.length; j++) baseline.push({ owner, key: names[j]!, descriptor: getOwnDescriptor(owner, names[j]!)! })
}

function hasNativePlanningIntrinsics(): boolean {
  for (let i = 0; i < baseline.length; i++) {
    const { owner, key, descriptor: expected } = baseline[i]!
    const current = getOwnDescriptor(owner, key)
    if (current === undefined) return false
    const currentValue = getOwnDescriptor(current, "value")?.value, expectedValue = getOwnDescriptor(expected, "value")?.value
    const currentGet = getOwnDescriptor(current, "get")?.value, expectedGet = getOwnDescriptor(expected, "get")?.value
    const currentSet = getOwnDescriptor(current, "set")?.value, expectedSet = getOwnDescriptor(expected, "set")?.value
    if (!objectIs(currentValue, expectedValue) || currentGet !== expectedGet || currentSet !== expectedSet) return false
  }
  const prepare = getOwnDescriptor(ReferenceDrcPrimitiveMemo.prototype, "prepareMissPlan")
  return prepare !== undefined && applyNative(hasOwn, prepare, ["value"]) && prepare.value === nativePrepare
}

function isCallbackFreeSnapshot(value: unknown, visiting: Set<object>): boolean {
  if (typeof value !== "object" || value === null) return true
  const inspector = getReferenceDrcProxyInspector()
  if (inspector === undefined || inspector(value)) return false
  if (visiting.has(value)) return true
  const prototype = getPrototypeOf(value)
  if ((isArray(value) && prototype !== arrayPrototype) || (!isArray(value) && prototype !== objectPrototype && prototype !== null)) return true
  if (getOwnSymbols(value).length !== 0) return true
  visiting.add(value)
  const names = getOwnNames(value)
  for (let i = 0; i < names.length; i++) {
    const descriptor = getOwnDescriptor(value, names[i]!)!
    if (!applyNative(hasOwn, descriptor, ["value"]) || !isCallbackFreeSnapshot(descriptor.value, visiting)) return false
  }
  visiting.delete(value)
  return true
}

/** No supplied instance or caller trust token can enable miss planning. */
export function prepareReferenceDrcPrimitiveMissPlan(memo: ReferenceDrcPrimitiveMemo, rows: readonly ReferenceDrcPrimitiveMissRow[]): ReferenceDrcPrimitiveMissPlan | undefined {
  // Membership is tested before inspecting either argument's properties.
  if (!isPrivatelyOwnedReferenceDrcPrimitiveMemo(memo) || !hasNativePlanningIntrinsics()) return undefined
  const inspector = getReferenceDrcProxyInspector()
  if (inspector === undefined || inspector(rows) || !isArray(rows) || getPrototypeOf(rows) !== arrayPrototype) return undefined
  for (let i = 0; i < rows.length; i++) {
    const slot = getOwnDescriptor(rows, String(i))
    if (slot === undefined || !applyNative(hasOwn, slot, ["value"])) return undefined
    const row = slot.value
    if (typeof row !== "object" || row === null || inspector(row) || getPrototypeOf(row) !== objectPrototype) return undefined
    const kind = getOwnDescriptor(row, "kind"), input = getOwnDescriptor(row, "input")
    if (kind === undefined || input === undefined || !applyNative(hasOwn, kind, ["value"]) || !applyNative(hasOwn, input, ["value"]) || typeof kind.value !== "string") return undefined
    if (!isCallbackFreeSnapshot(input.value, new Set())) return undefined
  }
  return applyNative(nativePrepare, memo, [rows]) as ReferenceDrcPrimitiveMissPlan
}
