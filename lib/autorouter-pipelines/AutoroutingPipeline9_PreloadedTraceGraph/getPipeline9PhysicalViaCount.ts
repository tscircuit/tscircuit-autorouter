import type { SimplifiedPcbTraces } from "lib/types"

export const getPipeline9PhysicalViaCount = ({
  traces,
  allowBlindAndBuriedVias,
}: {
  traces: SimplifiedPcbTraces
  allowBlindAndBuriedVias?: boolean
}): number => {
  const sitesByX = new Map<number, Set<number>>()
  let count = 0
  for (const trace of traces) {
    for (const point of trace.route) {
      if (point.route_type !== "via") continue
      if (allowBlindAndBuriedVias) {
        count++
        continue
      }
      const sites = sitesByX.get(point.x) ?? new Set<number>()
      if (sites.has(point.y)) continue
      sites.add(point.y)
      sitesByX.set(point.x, sites)
      count++
    }
  }
  return count
}
