import type { Obstacle } from "lib/types"

/** Returns source copper shapes for serializing electrical layer transitions. */
export function getPipeline9CopperObstacles(
  obstacles: readonly Obstacle[],
): Obstacle[] {
  return obstacles.map((obstacle) => ({
    ...obstacle,
    __usePhysicalCopperGeometry: true,
  }))
}
