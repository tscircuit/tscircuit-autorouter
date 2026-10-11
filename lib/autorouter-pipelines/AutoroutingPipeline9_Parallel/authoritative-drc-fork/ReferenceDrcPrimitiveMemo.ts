type CacheableSnapshot = { key: string } | { key: undefined }

export type ReferenceDrcPrimitiveMissRow = { kind: string; input: unknown }
export type ReferenceDrcPrimitiveMissPlan = {
  readonly rows: readonly { rowIndex: number; hit: boolean; cacheable: boolean }[]
  consume<T>(kind: string, input: unknown, compute: () => T): T
  finish(): void
}

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

  /** Invoked only through the actual private-owner planning gateway. */
  private prepareMissPlan(rows: readonly ReferenceDrcPrimitiveMissRow[]): ReferenceDrcPrimitiveMissPlan {
    const initialKeys = this.values.keys()
    const evictedInitialKeys = new Set<string>()
    const addedKeys = new Set<string>()
    let shadowSize = this.values.size
    const expected: { key: string | undefined; hit: boolean }[] = []
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex]!
      const snapshot = snapshotKey(row.input, new Set())
      const key = snapshot.key === undefined ? undefined : `${JSON.stringify(row.kind)}:${snapshot.key}`
      const hit = key !== undefined && (addedKeys.has(key) || (this.values.has(key) && !evictedInitialKeys.has(key)))
      expected.push({ key, hit })
      if (key === undefined || hit) continue
      addedKeys.add(key)
      shadowSize++
      if (shadowSize > this.maximumEntries) {
        let oldest = initialKeys.next()
        while (!oldest.done && evictedInitialKeys.has(oldest.value)) oldest = initialKeys.next()
        if (!oldest.done) evictedInitialKeys.add(oldest.value)
        else addedKeys.delete(addedKeys.keys().next().value!)
        shadowSize--
      }
    }
    let nextRow = 0
    return {
      rows: expected.map((row, rowIndex) => ({ rowIndex, hit: row.hit, cacheable: row.key !== undefined })),
      consume: <T>(kind: string, input: unknown, compute: () => T): T => {
        const row = expected[nextRow]
        if (row === undefined) throw new Error("Reference DRC miss plan consumed beyond its rows")
        const snapshot = snapshotKey(input, new Set())
        const key = snapshot.key === undefined ? undefined : `${JSON.stringify(kind)}:${snapshot.key}`
        const hit = key !== undefined && this.values.has(key)
        if (key !== row.key || hit !== row.hit) throw new Error(`Reference DRC miss plan diverged at row ${nextRow}`)
        nextRow++
        if (hit) {
          this.diagnostics.hits++
          return this.values.get(key!) as T
        }
        this.diagnostics.misses++
        const value = compute()
        if (key !== undefined) {
          this.values.set(key, value)
          if (this.values.size > this.maximumEntries) this.values.delete(this.values.keys().next().value!)
        }
        return value
      },
      finish: (): void => {
        if (nextRow !== expected.length) throw new Error(`Reference DRC miss plan has ${expected.length - nextRow} unconsumed rows`)
      },
    }
  }

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
