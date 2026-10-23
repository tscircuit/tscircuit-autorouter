import {
  segmentToBoundsMinDistance,
  segmentToSegmentMinDistance,
} from "@tscircuit/math-utils"
import type { SimpleRouteJson } from "./nativeRepairTypes"

type Point = { x: number; y: number }
export type ObstacleDistanceGeometry =
  | {
      type: "rect"
      bounds: { minX: number; maxX: number; minY: number; maxY: number }
    }
  | { type: "oval"; a: Point; b: Point; radius: number }

export function getLocalObstacleGeometry(
  obstacle: SimpleRouteJson["obstacles"][number],
): ObstacleDistanceGeometry {
  if (obstacle.isNonPlatedHole && obstacle.shape === "circle") {
    return {
      type: "oval",
      a: { x: 0, y: 0 },
      b: { x: 0, y: 0 },
      radius: obstacle.width / 2,
    }
  }
  if (obstacle.type === "rect") {
    return {
      type: "rect",
      bounds: {
        minX: -obstacle.width / 2,
        maxX: obstacle.width / 2,
        minY: -obstacle.height / 2,
        maxY: obstacle.height / 2,
      },
    }
  }
  if (obstacle.type !== "oval")
    throw new Error("repair04 found an unsupported obstacle shape")
  const halfSpine = Math.abs(obstacle.width - obstacle.height) / 2
  const dx = obstacle.width >= obstacle.height ? halfSpine : 0
  const dy = obstacle.height > obstacle.width ? halfSpine : 0
  return {
    type: "oval",
    a: { x: -dx, y: -dy },
    b: { x: dx, y: dy },
    radius: Math.min(obstacle.width, obstacle.height) / 2,
  }
}

export function getLocalObstacleDistance(
  a: Point,
  b: Point,
  geometry: ObstacleDistanceGeometry,
): number {
  if (geometry.type === "rect") {
    return segmentToBoundsMinDistance(a, b, geometry.bounds)
  }
  return Math.max(
    0,
    segmentToSegmentMinDistance(a, b, geometry.a, geometry.b) - geometry.radius,
  )
}
