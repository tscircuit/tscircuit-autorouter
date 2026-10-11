import { canUseExpectedPortsMemo } from "./canUseExpectedPortsMemo"
import { getReferenceDrcProxyInspector } from "./initializeReferenceDrcRuntime"
import { isPrivatelyOwnedReferenceDrcPrimitiveMemo } from "./native/lib/check-traces-are-contiguous/check-traces-are-contiguous"

type Snapshot = { key: string | undefined }
type InternReceiver = { nextIdentity: number; intern(value: unknown): number }
type CompletedSubkeys = { values: WeakMap<object, string>; entries: number; characters: number }
export type ReferenceDrcNativeInternAdmission = { kind: "literal" } | { kind: "scoped"; finish(): void }

const getDescriptor = Object.getOwnPropertyDescriptor
const defineProperty = Object.defineProperty
const deleteProperty = Reflect.deleteProperty
const applyNative = Reflect.apply
const hasOwn = Object.prototype.hasOwnProperty
const NativeWeakMap = WeakMap
const weakGet = WeakMap.prototype.get
const weakSet = WeakMap.prototype.set
const NativeMap = Map
const mapSize = getDescriptor(Map.prototype, "size")!.get!
const NativeWeakSet = WeakSet
const activeMemos = new NativeWeakSet<object>()
const activeHas = WeakSet.prototype.has
const activeAdd = WeakSet.prototype.add
const activeDelete = WeakSet.prototype.delete
const getPrototypeOf = Object.getPrototypeOf
const getOwnNames = Object.getOwnPropertyNames
const getOwnSymbols = Object.getOwnPropertySymbols
const MAX_INTERN_SUBKEYS = 100_000
const MAX_INTERN_CHARACTERS = 32_000_000

/** Pinned literal snapshot arithmetic; only completed object subkeys reuse. */
function internSnapshotKey(value: unknown, visiting: Set<object>, completed: CompletedSubkeys): Snapshot {
  if (value === undefined) return { key: "u" }
  if (value === null) return { key: "l" }
  if (typeof value === "number") return { key: `n${Object.is(value, -0) ? "-0" : String(value)};` }
  if (typeof value === "string") return { key: `s${JSON.stringify(value)}` }
  if (typeof value === "boolean") return { key: value ? "b1" : "b0" }
  if (typeof value === "bigint") return { key: `i${value};` }
  if (typeof value !== "object" || visiting.has(value)) return { key: undefined }
  const previous = applyNative(weakGet, completed.values, [value]) as string | undefined
  if (previous !== undefined) return { key: previous }
  const prototype = Object.getPrototypeOf(value)
  if (Array.isArray(value) && prototype !== Array.prototype) return { key: undefined }
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return { key: undefined }
  visiting.add(value)
  let key = Array.isArray(value) ? "a[" : "o{"
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    visiting.delete(value)
    return { key: undefined }
  }
  for (const property of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, property)!
    if (!("value" in descriptor)) {
      visiting.delete(value)
      return { key: undefined }
    }
    const nested = internSnapshotKey(descriptor.value, visiting, completed)
    if (nested.key === undefined) {
      visiting.delete(value)
      return nested
    }
    key += `${JSON.stringify(property)}:${nested.key},`
  }
  if (Array.isArray(value)) key += `length:${value.length}]`
  else key += "}"
  visiting.delete(value)
  if (completed.entries < MAX_INTERN_SUBKEYS && completed.characters + key.length <= MAX_INTERN_CHARACTERS) {
    applyNative(weakSet, completed.values, [value, key])
    completed.entries++
    completed.characters += key.length
  }
  return { key }
}

/** Actual ownership precedes reflection. The complete original Native guard
 * runs once here; an external memo or caller token cannot activate reuse.
 * This inherits that guard's module-first native-method contract. Source data
 * is immutable during its synchronous Native invocation; the sidecar stores
 * completed subkeys only and is discarded before return or raw error. */
export function beginReferenceDrcNativeInternScope(memo: unknown, circuitJson: unknown): ReferenceDrcNativeInternAdmission | undefined {
  if (!isPrivatelyOwnedReferenceDrcPrimitiveMemo(memo)) return undefined
  if (applyNative(activeHas, activeMemos, [memo])) throw new Error("Reference DRC intern scope is already active")
  if (!canUseExpectedPortsMemo(circuitJson)) return undefined
  // A hidden memo with an already supplied own method or observed transition
  // field retains its literal Native implementation, before any activation.
  if (getDescriptor(memo as object, "intern") !== undefined) return { kind: "literal" }
  const identities = getDescriptor(memo as object, "identities")
  const maximum = getDescriptor(memo as object, "maximumEntries")
  const next = getDescriptor(memo as object, "nextIdentity")
  if (identities === undefined || maximum === undefined || next === undefined ||
    !applyNative(hasOwn, identities, ["value"]) || !applyNative(hasOwn, maximum, ["value"]) || !applyNative(hasOwn, next, ["value"]) ||
    typeof identities.value !== "object" || identities.value === null || typeof maximum.value !== "number" || typeof next.value !== "number" || next.writable !== true) return { kind: "literal" }
  const inspector = getReferenceDrcProxyInspector()
  if (inspector === undefined || inspector(identities.value) || getPrototypeOf(identities.value) !== NativeMap.prototype ||
    getOwnNames(identities.value).length !== 0 || getOwnSymbols(identities.value).length !== 0) return { kind: "literal" }
  // The captured native getter distinguishes a genuine Map from an object
  // merely inheriting its prototype, without invoking supplied properties.
  try { applyNative(mapSize, identities.value, []) } catch { return { kind: "literal" } }
  const map = identities.value as Map<string, number>
  const maximumEntries = maximum.value as number
  const receiver = memo as InternReceiver
  const completed: CompletedSubkeys = { values: new NativeWeakMap<object, string>(), entries: 0, characters: 0 }
  // This is the original intern transition verbatim after its snapshot. It
  // still executes on every invocation, including identity FIFO eviction.
  const scopedIntern = (value: unknown): number => {
    const snapshot = internSnapshotKey(value, new Set(), completed)
    if (snapshot.key === undefined) return receiver.nextIdentity++
    const existing = map.get(snapshot.key)
    if (existing !== undefined) return existing
    const identity = receiver.nextIdentity++
    map.set(snapshot.key, identity)
    if (map.size > maximumEntries) map.delete(map.keys().next().value!)
    return identity
  }
  defineProperty(memo, "intern", { value: scopedIntern, configurable: true, writable: true, enumerable: false })
  applyNative(activeAdd, activeMemos, [memo])
  return {
    kind: "scoped",
    finish: (): void => {
      const current = getDescriptor(memo as object, "intern")
      if (current === undefined || !applyNative(hasOwn, current, ["value"]) || current.value !== scopedIntern) throw new Error("Reference DRC intern scope ownership changed")
      if (!deleteProperty(memo as object, "intern")) throw new Error("Reference DRC intern scope could not restore its Native method")
      applyNative(activeDelete, activeMemos, [memo])
    },
  }
}
