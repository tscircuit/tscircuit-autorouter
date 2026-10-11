import type { Obstacle } from "../../types"

/** Places copper in the same affine frame as a grow/shrink portfolio's ports. */
export function scalePhysicalCopperObstacles(
  obstacles: readonly Obstacle[], center: { x: number; y: number }, factor: number,
): Obstacle[] {
  if (!Number.isFinite(factor) || factor <= 0) throw new Error("Invalid copper scale factor")
  const scalePoint = (point: { x: number; y: number }) => ({
    x: center.x + (point.x - center.x) * factor,
    y: center.y + (point.y - center.y) * factor,
  })
  return obstacles.filter((obstacle) => obstacle.layers.length > 1).map((obstacle) => ({
    ...obstacle, center: scalePoint(obstacle.center), width: obstacle.width * factor,
    height: obstacle.height * factor,
    ...(obstacle.copperGeometry ? { copperGeometry: { ...obstacle.copperGeometry,
      center: scalePoint(obstacle.copperGeometry.center), width: obstacle.copperGeometry.width * factor,
      height: obstacle.copperGeometry.height * factor,
    } } : {}),
  }))
}
