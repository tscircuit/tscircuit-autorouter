const SHADOW_COUNTER_KEYS = [
  "instances", "lookups", "legacyHits", "legacyMisses", "legacyDistanceEvaluations",
  "candidateHits", "candidateMisses", "candidateDistanceEvaluations", "bothHits",
  "legacyOnlyHits", "candidateOnlyHits", "bothMisses", "assertedLegacyHits",
  "invalidations", "uncacheableQueries", "indexMismatches",
] as const

export type FuturePointCacheShadowStats = Record<(typeof SHADOW_COUNTER_KEYS)[number], number>
type FuturePoint = { x: number; y: number; z: number }

export const createFuturePointCacheShadowStats = (): FuturePointCacheShadowStats => {
  const stats = {} as FuturePointCacheShadowStats
  for (const key of SHADOW_COUNTER_KEYS) {
    stats[key] = 0
  }
  return stats
}

/** Diagnostic counterfactual work only; the selected index comes from the real search. */
export class FuturePointCacheShadow {
  private readonly coordinates = new Float64Array(256 * 4)
  private readonly indices = new Int32Array(256).fill(-2)
  private cachedPoints?: FuturePoint[]
  private cachedPointCount = 0

  constructor(private readonly stats: FuturePointCacheShadowStats) {
    stats.instances++
  }

  record(
    pointKey: number, x: number, y: number, z: number, viaPenaltyDistance: number,
    points: FuturePoint[], acceptedPointIndex: number, candidateHit: boolean,
    candidateDistanceEvaluations: number,
  ): void {
    const stats = this.stats
    stats.lookups++
    if (this.cachedPoints !== points || this.cachedPointCount !== points.length) {
      this.indices.fill(-2)
      this.cachedPoints = points
      this.cachedPointCount = points.length
      stats.invalidations++
    }
    // Copied native modulo placement, empty/null sentinels and exact guards.
    const cacheSlot = Number.isSafeInteger(pointKey) ? Math.abs(pointKey % 256) : -1
    const coordinateIndex = cacheSlot * 4
    const cachedPointIndex = this.indices[cacheSlot]
    const legacyHit = cacheSlot >= 0 && cachedPointIndex >= -1 &&
      this.coordinates[coordinateIndex] === x &&
      this.coordinates[coordinateIndex + 1] === y &&
      this.coordinates[coordinateIndex + 2] === z &&
      this.coordinates[coordinateIndex + 3] === viaPenaltyDistance
    if (legacyHit) {
      stats.legacyHits++
      stats.assertedLegacyHits++
      if (cachedPointIndex !== acceptedPointIndex) {
        stats.indexMismatches++
        throw new Error(`Future-point legacy shadow index divergence: native ${cachedPointIndex}, candidate ${acceptedPointIndex}`)
      }
    } else {
      stats.legacyMisses++
      // The native miss scans the complete array. This is point work, not CPU time.
      stats.legacyDistanceEvaluations += points.length
      if (cacheSlot >= 0) {
        this.coordinates[coordinateIndex] = x
        this.coordinates[coordinateIndex + 1] = y
        this.coordinates[coordinateIndex + 2] = z
        this.coordinates[coordinateIndex + 3] = viaPenaltyDistance
        this.indices[cacheSlot] = acceptedPointIndex
      } else stats.uncacheableQueries++
    }
    if (candidateHit) stats.candidateHits++
    else stats.candidateMisses++
    stats.candidateDistanceEvaluations += candidateDistanceEvaluations
    if (legacyHit) {
      if (candidateHit) stats.bothHits++
      else stats.legacyOnlyHits++
    } else if (candidateHit) stats.candidateOnlyHits++
    else stats.bothMisses++
  }
}
