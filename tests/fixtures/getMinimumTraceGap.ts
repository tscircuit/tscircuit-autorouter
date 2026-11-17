import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import type { SimplifiedPcbTrace } from "lib/types"

export function getMinimumTraceGap(
  firstTrace: SimplifiedPcbTrace,
  secondTrace: SimplifiedPcbTrace,
): number {
  let gap = Infinity
  for (let firstIndex = 1; firstIndex < firstTrace.route.length; firstIndex++) {
    const firstStart = firstTrace.route[firstIndex - 1]!
    const firstEnd = firstTrace.route[firstIndex]!
    if (firstStart.route_type !== "wire" || firstEnd.route_type !== "wire")
      continue
    if (firstStart.layer !== firstEnd.layer) continue
    for (
      let secondIndex = 1;
      secondIndex < secondTrace.route.length;
      secondIndex++
    ) {
      const secondStart = secondTrace.route[secondIndex - 1]!
      const secondEnd = secondTrace.route[secondIndex]!
      if (secondStart.route_type !== "wire" || secondEnd.route_type !== "wire")
        continue
      if (
        secondStart.layer !== secondEnd.layer ||
        firstStart.layer !== secondStart.layer
      )
        continue
      gap = Math.min(
        gap,
        segmentToSegmentMinDistance(
          firstStart,
          firstEnd,
          secondStart,
          secondEnd,
        ) -
          (firstStart.width + secondStart.width) / 2,
      )
    }
  }
  if (!Number.isFinite(gap))
    throw new Error("Traces have no same-layer segments")
  return gap
}
