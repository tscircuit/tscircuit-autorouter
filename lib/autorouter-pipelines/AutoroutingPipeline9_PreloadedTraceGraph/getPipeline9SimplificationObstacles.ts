import type { Obstacle, SimpleRouteJson } from "lib/types"

/** Adapt hole clearance to the simplifier's uniform obstacle margin. */
export const getPipeline9SimplificationObstacles = (
  srj: SimpleRouteJson,
): Obstacle[] => {
  // Path sampling uses 0.1 mm; via shortcuts may use a smaller pad margin.
  const simplificationMargin = Math.min(
    0.1,
    srj.minTraceToPadEdgeClearance ?? 0.15,
  )
  const holeExpansion = Math.max(
    0,
    (srj.minTraceToHoleEdgeClearance ?? 0.2) - simplificationMargin,
  )
  return srj.obstacles.map((obstacle): Obstacle =>
    obstacle.isNonPlatedHole && holeExpansion > 0
      ? {
          ...obstacle,
          width: obstacle.width + 2 * holeExpansion,
          height: obstacle.height + 2 * holeExpansion,
        }
      : obstacle,
  )
}
