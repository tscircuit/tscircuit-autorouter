import type { RegionAttemptRecord } from "./planning-types"
import type { SerialHybridEngineArtifacts } from "./serial-engine-types"
import type { HybridTransactionWorkCounters } from "./transactional-copper-types"
import type { HybridRouterMetrics } from "./types"

export const EMPTY_HYBRID_WORK_COUNTERS: HybridTransactionWorkCounters =
  Object.freeze({
    searchExpansions: 0,
    spatialIndexQueries: 0,
    drcPredicateCalls: 0,
    geometryAllocations: 0,
    candidatesConstructed: 0,
    candidatesStepped: 0,
    activeRings: 0,
    solverStateRebuilds: 0,
  })

export function createHybridRouterMetrics({
  totalElapsedMs,
  stageElapsedMs,
  artifacts,
  maximumConcurrency,
  peakHeapBytes,
  peakRssBytes,
  solveOutcome,
}: {
  totalElapsedMs: number
  stageElapsedMs: Readonly<Record<string, number>>
  artifacts?: SerialHybridEngineArtifacts
  maximumConcurrency: number
  peakHeapBytes: number
  peakRssBytes: number
  solveOutcome: HybridRouterMetrics["solveOutcome"]
}): HybridRouterMetrics {
  const attempts = artifacts?.attempts ?? []
  const committedAttempts = attempts.filter(
    (attempt) => attempt.outcome === "committed",
  )
  const workerCpuMs = sum(attempts, (attempt) => attempt.workerCpuMs)
  const solverElapsedMs = sum(attempts, (attempt) => attempt.solveTimeMs)
  const snapshot = artifacts?.copperSnapshot
  const routedLengthMm =
    snapshot?.segments.reduce(
      (total, segment) =>
        total +
        Math.hypot(
          segment.end.x - segment.start.x,
          segment.end.y - segment.start.y,
        ),
      0,
    ) ?? 0
  return Object.freeze({
    totalElapsedMs,
    stageElapsedMs: Object.freeze({ ...stageElapsedMs }),
    regionElapsedMs: Object.freeze(
      getRegionElapsedMs(attempts),
    ),
    queueWaitMs: sum(attempts, (attempt) => attempt.queueWaitMs),
    workerCpuMs,
    solverElapsedMs,
    searchExpansions: sumWork(attempts, "searchExpansions"),
    candidatesConstructed: sumWork(attempts, "candidatesConstructed"),
    candidatesStepped: sumWork(attempts, "candidatesStepped"),
    drcPredicateCalls: sumWork(attempts, "drcPredicateCalls"),
    spatialIndexQueries: sumWork(attempts, "spatialIndexQueries"),
    transferredBytes: sum(attempts, (attempt) => attempt.transferredBytes),
    clonedBytes: sum(attempts, (attempt) => attempt.returnedBytes),
    transactionCommits: committedAttempts.length,
    transactionRejections: attempts.filter(
      (attempt) => attempt.outcome === "rejected",
    ).length,
    staleRevalidations: attempts.filter(
      (attempt) => attempt.wasStaleRevalidation,
    ).length,
    cancellations: attempts.filter(
      (attempt) => attempt.outcome === "cancelled",
    ).length,
    regionSplits: artifacts?.regionGraph.splitCount ?? 0,
    regionMerges: artifacts?.regionGraph.mergeCount ?? 0,
    regionRequeues: attempts.filter((attempt) => attempt.requeueIndex > 0).length,
    solverStateRebuilds: sumWork(attempts, "solverStateRebuilds"),
    geometryAllocations: sumWork(attempts, "geometryAllocations"),
    peakHeapBytes,
    peakRssBytes,
    workerUtilization:
      totalElapsedMs > 0
        ? Math.min(1, workerCpuMs / (totalElapsedMs * maximumConcurrency))
        : 0,
    cacheHits: artifacts?.cache.hits ?? 0,
    cacheMisses: artifacts?.cache.misses ?? 0,
    cacheEvictions: artifacts?.cache.evictions ?? 0,
    cacheStoredBytes: artifacts?.cache.storedBytes ?? 0,
    cacheValidationMs: artifacts?.cache.validationMs ?? 0,
    viaCount: snapshot?.vias.length ?? 0,
    routedLengthMm,
    bendCount: snapshot ? countGeometricBends(snapshot.segments) : 0,
    solveOutcome,
  })
}

function getRegionElapsedMs(
  attempts: readonly RegionAttemptRecord[],
): Readonly<Record<string, number>> {
  const elapsedByRegion: Record<string, number> = {}
  for (const attempt of attempts) {
    elapsedByRegion[attempt.regionId] =
      (elapsedByRegion[attempt.regionId] ?? 0) + attempt.solveTimeMs
  }
  return elapsedByRegion
}

function countGeometricBends(
  segments: SerialHybridEngineArtifacts["copperSnapshot"]["segments"],
): number {
  let bends = 0
  for (let firstIndex = 0; firstIndex < segments.length; firstIndex++) {
    const first = segments[firstIndex]!
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < segments.length;
      secondIndex++
    ) {
      const second = segments[secondIndex]!
      if (
        first.connectionName !== second.connectionName ||
        first.layer !== second.layer ||
        !segmentsShareEndpoint(first, second)
      ) {
        continue
      }
      const firstDx = first.end.x - first.start.x
      const firstDy = first.end.y - first.start.y
      const secondDx = second.end.x - second.start.x
      const secondDy = second.end.y - second.start.y
      if (Math.abs(firstDx * secondDy - firstDy * secondDx) > 1e-9) bends += 1
    }
  }
  return bends
}

function segmentsShareEndpoint(
  first: SerialHybridEngineArtifacts["copperSnapshot"]["segments"][number],
  second: SerialHybridEngineArtifacts["copperSnapshot"]["segments"][number],
): boolean {
  return [first.start, first.end].some((firstPoint) =>
    [second.start, second.end].some(
      (secondPoint) =>
        Math.abs(firstPoint.x - secondPoint.x) <= 1e-9 &&
        Math.abs(firstPoint.y - secondPoint.y) <= 1e-9,
    ),
  )
}

function sum(
  attempts: readonly RegionAttemptRecord[],
  select: (attempt: RegionAttemptRecord) => number,
): number {
  return attempts.reduce((total, attempt) => total + select(attempt), 0)
}

function sumWork(
  attempts: readonly RegionAttemptRecord[],
  key: keyof HybridTransactionWorkCounters,
): number {
  return sum(attempts, (attempt) => attempt.work[key])
}
