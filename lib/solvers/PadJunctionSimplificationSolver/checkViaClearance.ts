import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { isPointInRect } from "lib/utils/isPointInRect"
import {
  EPSILON,
  type Point,
  type PadJunctionContext,
  type PadT,
} from "./padJunctionTypes"
export function checkViaClearance(
  context: PadJunctionContext,
  t: PadT,
  segments: [Point, Point][],
  sameNet: boolean,
  route: HighDensityRoute,
): string | null {
  const { runs } = t
  const { pad, width } = t.v
  for (const via of route.vias) {
    if (
      !sameNet &&
      segments.some(
        ([start, end]) =>
          pointToSegmentDistance(via, start, end) <
          (width + route.viaDiameter) / 2 + context.clearance - EPSILON,
      )
    )
      return "Head or stem violates via clearance"
    if (
      sameNet &&
      !isPointInRect(via, pad) &&
      runs.some(
        (removed) =>
          Math.hypot(via.x - removed.cut.x, via.y - removed.cut.y) >
            (width + route.viaDiameter) / 2 + EPSILON &&
          pointToSegmentDistance(via, removed.cut, removed.terminal) <
            (width + route.viaDiameter) / 2 - EPSILON,
      )
    )
      return "A removed run has an existing via tap"
  }
  return null
}
