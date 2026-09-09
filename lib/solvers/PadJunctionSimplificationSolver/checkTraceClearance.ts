import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { isPointInRect } from "lib/utils/isPointInRect"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import {
  EPSILON,
  type Point,
  type PadJunctionContext,
  type PadT,
} from "./padJunctionTypes"
export function checkTraceClearance(
  context: PadJunctionContext,
  t: PadT,
  segments: [Point, Point][],
  sameNet: boolean,
  route: HighDensityRoute,
  points: Point[],
): string | null {
  const { runs } = t
  const { pad, width } = t.v
  const z = t.replacement.junction.z
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1]!
    const end = points[index]!
    if (start.z !== z || end.z !== z) continue
    const copperWidth = start.traceThickness ?? route.traceThickness
    if (!sameNet) {
      if (
        segments.some(
          ([a, b]) =>
            minimumDistanceBetweenSegments(a, b, start, end) <
            (width + copperWidth) / 2 + context.clearance - EPSILON,
        )
      )
        return "Head or stem violates trace clearance"
      continue
    }
    if (isPointInRect(start, pad) && isPointInRect(end, pad)) continue
    for (const removed of runs) {
      // Copper touching the preserved cut remains connected after replacement.
      if (
        pointToSegmentDistance(removed.cut, start, end) <=
        (width + copperWidth) / 2 + EPSILON
      )
        continue
      if (
        minimumDistanceBetweenSegments(
          removed.cut,
          removed.terminal,
          start,
          end,
        ) <
        (width + copperWidth) / 2 - EPSILON
      )
        return "A removed run has an existing copper tap"
    }
  }

  return null
}
