import { segmentToBoxMinDistance } from "@tscircuit/math-utils"

import {
  EPSILON,
  type Point,
  type PadJunctionContext,
  type PadT,
} from "./padJunctionTypes"
export function checkPadClearance(
  context: PadJunctionContext,
  t: PadT,
  segments: [Point, Point][],
  nets: Set<string>,
): string | null {
  const { runs, replacement } = t
  const { pad, width } = t.v
  const z = replacement.junction.z
  for (const obstacle of context.pads) {
    if (obstacle === pad || !obstacle.__zLayers.includes(z)) continue
    if (obstacle.ccwRotationDegrees) return "Rotated obstacles are unsupported"
    const sameNet = obstacle.connectedTo.some((identity) =>
      nets.has(context.getNet(identity)),
    )
    if (
      sameNet &&
      runs.some(
        (run) =>
          segmentToBoxMinDistance(run.cut, run.cut, obstacle) <=
          width / 2 + EPSILON,
      )
    )
      continue
    if (
      sameNet &&
      runs.some(
        (run) =>
          segmentToBoxMinDistance(run.cut, run.terminal, obstacle) <
          width / 2 - EPSILON,
      )
    )
      return "A removed run touches another connected pad"
    if (
      segments.some(
        ([start, end]) =>
          segmentToBoxMinDistance(start, end, obstacle) <
          width / 2 + context.clearance - EPSILON,
      )
    )
      return "Head or stem violates pad clearance"
  }
  return null
}
