import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"

const DEFAULT_PRUNE_THRESHOLD = 1_100
const DEFAULT_TARGET_TOTAL_PORT_POINTS = 700

export const pruneSharedEdgeSegmentsForTinyHypergraph = (
  sharedEdgeSegments: SharedEdgeSegment[],
  maxTotalPortPoints = DEFAULT_TARGET_TOTAL_PORT_POINTS,
  pruneThreshold = DEFAULT_PRUNE_THRESHOLD,
): SharedEdgeSegment[] => {
  const totalPortPoints = sharedEdgeSegments.reduce(
    (sum, segment) => sum + segment.portPoints.length,
    0,
  )

  if (totalPortPoints <= pruneThreshold) {
    return sharedEdgeSegments
  }

  const keepRatio = maxTotalPortPoints / totalPortPoints

  return sharedEdgeSegments.map((segment) => {
    const portPointsByZ = new Map<number, typeof segment.portPoints>()

    for (const portPoint of segment.portPoints) {
      const z = portPoint.availableZ[0] ?? 0
      if (!portPointsByZ.has(z)) {
        portPointsByZ.set(z, [])
      }
      portPointsByZ.get(z)!.push(portPoint)
    }

    const prunedPortPoints = Array.from(portPointsByZ.entries()).flatMap(
      ([, portPoints]) => {
        const sortedPortPoints = [...portPoints].sort((a, b) => {
          if (a.cramped !== b.cramped) {
            return Number(a.cramped) - Number(b.cramped)
          }
          return a.distToCentermostPortOnZ - b.distToCentermostPortOnZ
        })

        const keepCount = Math.max(
          1,
          Math.min(
            sortedPortPoints.length,
            Math.ceil(sortedPortPoints.length * keepRatio),
          ),
        )

        return sortedPortPoints.slice(0, keepCount)
      },
    )

    return {
      ...segment,
      portPoints: prunedPortPoints,
    }
  })
}
