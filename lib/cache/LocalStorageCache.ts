import { CacheProvider } from "./types"

const CACHE_PREFIX = "tscircuit_autorouter_cache_"

/**
 * A CacheProvider implementation using the browser's localStorage.
 * Note: localStorage has size limits (typically 5-10MB) and stores data as strings.
 * Complex objects will be JSON serialized/deserialized.
 */
export class LocalStorageCache implements CacheProvider {
  isSyncCache = true
  cacheHits = 0
  cacheMisses = 0

  cacheHitsByPrefix: Record<string, number> = {}
  cacheMissesByPrefix: Record<string, number> = {}

  constructor() {}

  private getKey(cacheKey: string): string {
    return `${CACHE_PREFIX}${cacheKey}`
  }

  /**
   * Retrieves a cached solution synchronously from localStorage.
   * Increments cache hit/miss counters.
   * @param cacheKey The key to look up in the cache.
   * @returns The cached solution if found and parsed correctly, otherwise undefined.
   */
  getCachedSolutionSync(cacheKey: string): any {
    if (typeof localStorage === "undefined") return undefined

    const key = this.getKey(cacheKey)
    try {
      const cachedItem = localStorage.getItem(key)
      if (cachedItem !== null) {
        const solution = JSON.parse(cachedItem)
        this.cacheHits++
        const prefix = cacheKey.split(":")[0]
        this.cacheHitsByPrefix[prefix] =
          (this.cacheHitsByPrefix[prefix] || 0) + 1
        // console.log(`Cache hit (sync) for: ${cacheKey}`)
        return solution // No need for structuredClone, JSON parse creates a new object
      } else {
        this.cacheMisses++
        const prefix = cacheKey.split(":")[0]
        this.cacheMissesByPrefix[prefix] =
          (this.cacheMissesByPrefix[prefix] || 0) + 1
        // console.log(`Cache miss (sync) for: ${cacheKey}`)
        return undefined
      }
    } catch (error) {
      console.error(`Error getting cached solution sync for ${key}:`, error)
      this.cacheMisses++ // Count as miss if retrieval/parsing fails
      const prefix = cacheKey.split(":")[0]
      this.cacheMissesByPrefix[prefix] =
        (this.cacheMissesByPrefix[prefix] || 0) + 1
      // Optionally remove the corrupted item
      // localStorage.removeItem(key);
      return undefined
    }
  }

  /**
   * Retrieves a cached solution asynchronously. Wraps the synchronous method.
   * @param cacheKey The key to look up in the cache.
   * @returns A promise that resolves with the cached solution or undefined.
   */
  async getCachedSolution(cacheKey: string): Promise<any> {
    // localStorage API is synchronous, so we just wrap the sync method
    return this.getCachedSolutionSync(cacheKey)
  }

  /**
   * Stores a solution in localStorage synchronously.
   * The solution is JSON stringified before storing.
   * @param cacheKey The key under which to store the solution.
   * @param cachedSolution The solution data to cache.
   */
  setCachedSolutionSync(cacheKey: string, cachedSolution: any): void {
    if (typeof localStorage === "undefined") return

    const key = this.getKey(cacheKey)
    try {
      const stringifiedSolution = JSON.stringify(cachedSolution)
      localStorage.setItem(key, stringifiedSolution)
    } catch (error) {
      console.error(`Error setting cached solution sync for ${key}:`, error)
      // Handle potential storage quota errors
      if (
        error instanceof DOMException &&
        (error.name === "QuotaExceededError" ||
          error.name === "NS_ERROR_DOM_QUOTA_REACHED")
      ) {
        console.warn(
          `LocalStorage quota exceeded. Failed to cache solution for ${key}. Consider clearing the cache.`,
        )
        // Potential strategy: Implement LRU eviction here
      }
    }
  }

  /**
   * Stores a solution in the cache asynchronously. Wraps the synchronous method.
   * @param cacheKey The key under which to store the solution.
   * @param cachedSolution The solution data to cache.
   * @returns A promise that resolves when the solution is cached.
   */
  async setCachedSolution(
    cacheKey: string,
    cachedSolution: any,
  ): Promise<void> {
    // localStorage API is synchronous, so we just wrap the sync method
    this.setCachedSolutionSync(cacheKey, cachedSolution)
  }

  /**
   * Clears all cache entries created by this instance from localStorage
   * and resets hit/miss counters.
   */
  clearCache(): void {
    if (typeof localStorage === "undefined") return

    try {
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith(CACHE_PREFIX)) {
          keysToRemove.push(key)
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key))
      console.log(
        `Cleared ${keysToRemove.length} items from LocalStorage cache.`,
      )
    } catch (error) {
      console.error("Error clearing LocalStorage cache:", error)
    } finally {
      this.cacheHits = 0
      this.cacheMisses = 0
      this.cacheHitsByPrefix = {}
      this.cacheMissesByPrefix = {}
    }
  }

  getAllCacheKeys(): string[] {
    const cacheKeys: string[] = []
    for (let i = 0; i < 10_000; i++) {
      const keyName = localStorage.key(i)
      if (!keyName) break
      if (!keyName.includes(CACHE_PREFIX)) continue
      cacheKeys.push(keyName)
    }
    return cacheKeys
  }
}
