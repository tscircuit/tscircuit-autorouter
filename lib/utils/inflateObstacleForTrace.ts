import type { Obstacle } from "../types/SimpleRouteJson"
import { getTraceClearance } from "./getTraceClearance"

/**
 * Return an "inflated" copy of an obstacle that accounts for the physical
 * width of the trace being routed.
 *
 * When a pathfinder operates on centre-lines it must keep the centre at
 * least `traceWidth/2 + minGap` away from every obstacle edge.  We achieve
 * this by enlarging each obstacle by that margin on all sides before
 * running the search.
 *
 * @param obstacle         Source obstacle (not mutated).
 * @param traceWidthMm     Width of the trace being routed, in mm.
 * @param minClearanceGap  Minimum conductor-to-conductor gap (default 0.1 mm).
 */
export function inflateObstacleForTrace(
  obstacle: Obstacle,
  traceWidthMm: number,
  minClearanceGap = 0.1,
): Obstacle {
  const margin = getTraceClearance(traceWidthMm, minClearanceGap)

  if (obstacle.type === "rect") {
    return {
      ...obstacle,
      width: (obstacle.width ?? 0) + margin * 2,
      height: (obstacle.height ?? 0) + margin * 2,
    }
  }

  if (obstacle.type === "circle") {
    return {
      ...obstacle,
      radius: (obstacle.radius ?? 0) + margin,
    }
  }

  // Fallback – return unchanged (unknown shape)
  return obstacle
}

/**
 * Inflate a list of obstacles for a given trace width, skipping any obstacle
 * that belongs to the same net as the connection being routed (same-net
 * clearance relaxation).
 *
 * @param obstacles        Full obstacle list.
 * @param traceWidthMm     Width of the trace being routed.
 * @param connectionName   Net name of the connection being routed.
 * @param minClearanceGap  Minimum conductor-to-conductor gap (default 0.1 mm).
 */
export function inflateObstaclesForTrace(
  obstacles: Obstacle[],
  traceWidthMm: number,
  connectionName: string,
  minClearanceGap = 0.1,
): Obstacle[] {
  return obstacles.map((obs) => {
    // Same-net obstacles: no need to maintain clearance (they will be merged)
    if (obs.connectedTo.includes(connectionName)) {
      return obs
    }
    return inflateObstacleForTrace(obs, traceWidthMm, minClearanceGap)
  })
}
