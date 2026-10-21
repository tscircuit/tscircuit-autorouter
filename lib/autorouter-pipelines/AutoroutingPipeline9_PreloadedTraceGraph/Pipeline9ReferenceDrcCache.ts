import type { DrcEvaluator } from "high-density-repair03/lib"

type DrcResult = ReturnType<DrcEvaluator>

/** Preserves the last result and bounds additional exact-reference reuse. */
export class Pipeline9ReferenceDrcCache {
  private readonly results = new Map<string, DrcResult>()
  private lastResult?: { key: string; result: DrcResult }
  private contextKey?: string
  private keyCharacters = 0
  private hitCount = 0
  private consecutiveHitCount = 0
  private nonconsecutiveHitCount = 0
  private missCount = 0
  private evictionCount = 0
  private oversizedSkipCount = 0
  private contextInvalidationCount = 0

  constructor(
    readonly maxEntries = 64,
    readonly maxKeyCharacters = 8 * 1024 * 1024,
  ) {
    if (
      !Number.isSafeInteger(maxEntries) ||
      maxEntries < 1 ||
      !Number.isSafeInteger(maxKeyCharacters) ||
      maxKeyCharacters < 1
    ) {
      throw new Error("Reference DRC cache limits must be positive integers")
    }
  }

  setContext(key: string): void {
    if (this.contextKey !== undefined && this.contextKey !== key) {
      this.results.clear()
      this.lastResult = undefined
      this.keyCharacters = 0
      this.contextInvalidationCount++
    }
    this.contextKey = key
  }

  get(key: string): DrcResult | undefined {
    if (this.lastResult?.key === key) {
      this.hitCount++
      this.consecutiveHitCount++
      return this.lastResult.result
    }
    const result = this.results.get(key)
    if (result === undefined) {
      this.missCount++
      return undefined
    }
    this.hitCount++
    this.nonconsecutiveHitCount++
    this.results.delete(key)
    this.results.set(key, result)
    this.lastResult = { key, result }
    return result
  }

  set(key: string, result: DrcResult): void {
    // Keep the original consecutive-hit behavior even for oversized keys.
    this.lastResult = { key, result }
    if (key.length > this.maxKeyCharacters) {
      this.oversizedSkipCount++
      return
    }
    if (this.results.delete(key)) this.keyCharacters -= key.length
    while (
      this.results.size >= this.maxEntries ||
      this.keyCharacters + key.length > this.maxKeyCharacters
    ) {
      const oldest = this.results.keys().next().value
      if (oldest === undefined) break
      this.results.delete(oldest)
      this.keyCharacters -= oldest.length
      this.evictionCount++
    }
    this.results.set(key, result)
    this.keyCharacters += key.length
  }

  getStats(): Record<string, number> {
    return {
      referenceDrcCacheHitCount: this.hitCount,
      referenceDrcCacheConsecutiveHitCount: this.consecutiveHitCount,
      referenceDrcCacheNonconsecutiveHitCount: this.nonconsecutiveHitCount,
      referenceDrcCacheMissCount: this.missCount,
      referenceDrcCacheEvictionCount: this.evictionCount,
      referenceDrcCacheOversizedSkipCount: this.oversizedSkipCount,
      referenceDrcCacheContextInvalidationCount: this.contextInvalidationCount,
      referenceDrcCacheSize: this.results.size,
      referenceDrcCacheKeyCharacters: this.keyCharacters,
      referenceDrcCacheCapacity: this.maxEntries,
      referenceDrcCacheMaxKeyCharacters: this.maxKeyCharacters,
      referenceDrcCacheLastKeyCharacters: this.lastResult?.key.length ?? 0,
    }
  }
}
