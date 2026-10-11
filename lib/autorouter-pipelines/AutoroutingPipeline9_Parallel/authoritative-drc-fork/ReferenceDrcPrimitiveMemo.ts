type CacheableSnapshot = { key: string } | { key: undefined }

function snapshotKey(value: unknown, visiting: Set<object>): CacheableSnapshot {
  if (value === undefined) return { key: "u" }
  if (value === null) return { key: "l" }
  if (typeof value === "number") {
    return { key: `n${Object.is(value, -0) ? "-0" : String(value)};` }
  }
  if (typeof value === "string") return { key: `s${JSON.stringify(value)}` }
  if (typeof value === "boolean") return { key: value ? "b1" : "b0" }
  if (typeof value === "bigint") return { key: `i${value};` }
  if (typeof value !== "object" || visiting.has(value)) return { key: undefined }
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
    const nested = snapshotKey(descriptor.value, visiting)
    if (nested.key === undefined) {
      visiting.delete(value)
      return nested
    }
    key += `${JSON.stringify(property)}:${nested.key},`
  }
  if (Array.isArray(value)) key += `length:${value.length}]`
  else key += "}"
  visiting.delete(value)
  return { key }
}

/** Exact immutable snapshots; numeric keys retain NaN, infinities and -0. */
export class ReferenceDrcPrimitiveMemo {
  private readonly identities = new Map<string, number>()
  private readonly values = new Map<string, unknown>()
  private nextIdentity = 1
  readonly diagnostics = { hits: 0, misses: 0 }

  constructor(private readonly maximumEntries = 100_000) {}

  intern(value: unknown): number {
    const snapshot = snapshotKey(value, new Set())
    if (snapshot.key === undefined) return this.nextIdentity++
    const existing = this.identities.get(snapshot.key)
    if (existing !== undefined) return existing
    const identity = this.nextIdentity++
    this.identities.set(snapshot.key, identity)
    if (this.identities.size > this.maximumEntries) {
      this.identities.delete(this.identities.keys().next().value!)
    }
    return identity
  }

  getOrCompute<T>(kind: string, input: unknown, compute: () => T): T {
    const snapshot = snapshotKey(input, new Set())
    if (snapshot.key === undefined) {
      this.diagnostics.misses++
      return compute()
    }
    const key = `${JSON.stringify(kind)}:${snapshot.key}`
    if (this.values.has(key)) {
      this.diagnostics.hits++
      return this.values.get(key) as T
    }
    this.diagnostics.misses++
    const value = compute()
    this.values.set(key, value)
    if (this.values.size > this.maximumEntries) {
      this.values.delete(this.values.keys().next().value!)
    }
    return value
  }
}
