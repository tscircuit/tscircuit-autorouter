import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { isPointInOrOnPolygon } from "lib/utils/polygonContainment"

import {
  EPSILON,
  type Point,
  type PadJunctionContext,
} from "./padJunctionTypes"
export function checkBoardClearance(
  context: PadJunctionContext,
  width: number,
  segments: [Point, Point][],
): string | null {
  const margin = width / 2 + context.boardClearance
  let outline: { x: number; y: number }[] | undefined
  if (context.input.outline) outline = [...context.input.outline]
  for (const [start, end] of segments) {
    if (outline) {
      if (
        !isPointInOrOnPolygon(start, outline) ||
        !isPointInOrOnPolygon(end, outline)
      )
        return "Head or stem leaves the board"
      for (let index = 0; index < outline.length; index++)
        if (
          minimumDistanceBetweenSegments(
            start,
            end,
            outline[index]!,
            outline[(index + 1) % outline.length]!,
          ) <
          margin - EPSILON
        )
          return "Head or stem violates board clearance"
    } else if (context.input.bounds) {
      const { minX, minY, maxX, maxY } = context.input.bounds
      if (
        [start, end].some(
          (point) =>
            point.x < minX + margin - EPSILON ||
            point.x > maxX - margin + EPSILON ||
            point.y < minY + margin - EPSILON ||
            point.y > maxY - margin + EPSILON,
        )
      )
        return "Head or stem violates board clearance"
    }
  }
  return null
}
