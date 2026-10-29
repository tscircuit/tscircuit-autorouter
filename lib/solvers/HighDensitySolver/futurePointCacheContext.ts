import type { FutureConnection } from "./SingleHighDensityRouteSolver"
import { createFuturePointCacheShadowStats, type FuturePointCacheShadowStats } from "./futurePointCacheShadow"

const FUTURE_POINT_CACHE_COUNTER_KEYS = [
  "instances", "lookups", "hits", "misses", "distanceEvaluations",
  "entryProbes", "occupiedMissProbes", "stores", "evictions", "coldStores",
  "invalidations", "identityInvalidations", "lengthInvalidations",
  "uncacheableQueries", "mixedHashLookups", "associativeLookups",
] as const

export type FuturePointCacheStats = Record<
  (typeof FUTURE_POINT_CACHE_COUNTER_KEYS)[number], number
>

const ownedConstructionOptions = new WeakMap<object, {
  futures: FutureConnection[]
  stats: FuturePointCacheStats
}>()

export const createFuturePointCacheStats = (): FuturePointCacheStats => {
  const stats = {} as FuturePointCacheStats
  for (const key of FUTURE_POINT_CACHE_COUNTER_KEYS) {
    stats[key] = 0
  }
  return stats
}

/** Only unchanged internal options are admitted, once, for an owned lifetime. */
export const registerOwnedFuturePointCacheOptions = <T extends {
  futureConnections?: FutureConnection[]
}>(opts: T, stats: FuturePointCacheStats): T => {
  if (!opts.futureConnections) throw new Error("Owned future-point cache requires its concrete future list")
  ownedConstructionOptions.set(opts, { futures: opts.futureConnections, stats })
  return opts
}

export const consumeOwnedFuturePointCacheOptions = (
  opts: object,
  futures: FutureConnection[],
): FuturePointCacheStats | undefined => {
  const owned = ownedConstructionOptions.get(opts)
  ownedConstructionOptions.delete(opts)
  return owned?.futures === futures ? owned.stats : undefined
}

/** Fold row/layer bits into low slots; exact coordinates still guard every hit. */
export const mixFuturePointCacheKey = (key: number): number => {
  const low = key | 0
  const high = (key / 0x100000000) | 0
  let mixed = low ^ high
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x9e3779b1)
  return (mixed ^ (mixed >>> 16)) >>> 0
}

// Diagnostic source only: the clean measured cache has no shadow workspace.
const futurePointCacheShadows = new WeakMap<FuturePointCacheStats, FuturePointCacheShadowStats>()

export const getFuturePointCacheShadowStats = (
  stats: FuturePointCacheStats,
): FuturePointCacheShadowStats => {
  let shadow = futurePointCacheShadows.get(stats)
  if (!shadow) {
    shadow = createFuturePointCacheShadowStats()
    futurePointCacheShadows.set(stats, shadow)
  }
  return shadow
}
