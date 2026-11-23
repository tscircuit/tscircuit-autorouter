import {
  type Point,
  segmentToBoxMinDistance,
  segmentToCircleMinDistance,
} from "@tscircuit/math-utils"
import type { Obstacle } from "lib/types"
import { applyToPoint, rotateDEG, translate } from "transformation-matrix"

type ObstacleGeometry = Pick<
  Obstacle,
  "center" | "width" | "height" | "shape" | "ccwRotationDegrees"
>

export const getSegmentToObstacleDistance = ({
  start,
  end,
  obstacle,
}: {
  start: Point
  end: Point
  obstacle: ObstacleGeometry
}): number => {
  if (obstacle.shape === "circle") {
    return segmentToCircleMinDistance(start, end, {
      ...obstacle.center,
      radius: obstacle.width / 2,
    })
  }
  const translation = translate(-obstacle.center.x, -obstacle.center.y)
  const rotation = rotateDEG(-(obstacle.ccwRotationDegrees ?? 0))
  const localStart = applyToPoint(rotation, applyToPoint(translation, start))
  const localEnd = applyToPoint(rotation, applyToPoint(translation, end))
  return segmentToBoxMinDistance(localStart, localEnd, {
    center: { x: 0, y: 0 },
    width: obstacle.width,
    height: obstacle.height,
  })
}
