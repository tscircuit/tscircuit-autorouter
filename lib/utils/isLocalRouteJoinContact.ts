import {
  doSegmentsIntersect,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { trimSegmentAtTerminal } from "./trimSegmentAtTerminal"

type Point = { x: number; y: number }
type Segment = [Point, Point]

/** A subdivided bend may share its adjacent joins' end caps, never its bodies.
 * Require a contiguous local approach, then check each segment outside its join
 * contact region against the entire other segment. Returning legs still collide. */
export const isLocalRouteJoinContact = (
  route: HighDensityRoute,
  firstIndex: number,
  secondIndex: number,
  contactDiameter: number,
): boolean => {
  const startIndex = Math.min(firstIndex, secondIndex)
  const endIndex = Math.max(firstIndex, secondIndex)
  const first: Segment = [
    route.route[startIndex]!,
    route.route[startIndex + 1]!,
  ]
  const second: Segment = [route.route[endIndex]!, route.route[endIndex + 1]!]
  for (let index = startIndex + 1; index <= endIndex; index++) {
    const point = route.route[index]!
    if (
      point.z !== route.route[startIndex]!.z ||
      point.toNextSegmentType ||
      Math.hypot(point.x - first[1].x, point.y - first[1].y) >=
        contactDiameter ||
      Math.hypot(point.x - second[0].x, point.y - second[0].y) >=
        contactDiameter
    )
      return false
  }
  const overlaps = ([a, b]: Segment, [c, d]: Segment): boolean => {
    const distance = doSegmentsIntersect(a, b, c, d)
      ? 0
      : Math.min(
          pointToSegmentDistance(a, c, d),
          pointToSegmentDistance(b, c, d),
          pointToSegmentDistance(c, a, b),
          pointToSegmentDistance(d, a, b),
        )
    return distance < contactDiameter - 1e-8
  }
  const firstBody = trimSegmentAtTerminal(first, first[1], contactDiameter)
  const secondBody = trimSegmentAtTerminal(second, second[0], contactDiameter)
  return (
    (!firstBody || !overlaps(firstBody, second)) &&
    (!secondBody || !overlaps(first, secondBody))
  )
}
