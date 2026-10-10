import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { SimplifiedPcbTrace } from "lib/types"

type WirePoint = Extract<
  SimplifiedPcbTrace["route"][number],
  { route_type: "wire" }
>

/** Keep cleanup within one trace width of the original centerline. */
export const isWithinTraceCleanupCorridor = (
  path: WirePoint[],
  originalTrace: SimplifiedPcbTrace,
): boolean => {
  const maximumDeviation = path[0]!.width
  const segments = originalTrace.route.slice(1).flatMap((end, index) => {
    const start = originalTrace.route[index]!
    if (
      start.route_type !== "wire" ||
      end.route_type !== "wire" ||
      start.layer !== path[0]!.layer ||
      end.layer !== start.layer
    )
      return []
    return [{ start, end }]
  })
  for (let index = 1; index < path.length; index++) {
    const start = path[index - 1]!
    const end = path[index]!
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    const divisions = Math.max(1, Math.ceil(length / (maximumDeviation / 2)))
    // Distance to a polyline is 1-Lipschitz; reserve half the sample spacing.
    const sampleClearance = maximumDeviation - length / divisions / 2
    for (let sample = 0; sample <= divisions; sample++) {
      const point = {
        x: start.x + ((end.x - start.x) * sample) / divisions,
        y: start.y + ((end.y - start.y) * sample) / divisions,
      }
      if (
        !segments.some(
          ({ start, end }) =>
            pointToSegmentDistance(point, start, end) <= sampleClearance,
        )
      )
        return false
    }
  }
  return true
}
