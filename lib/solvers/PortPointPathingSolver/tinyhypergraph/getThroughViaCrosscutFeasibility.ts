import type { TinyHyperGraphRegionSegmentFeasibilityResult } from "tiny-hypergraph/lib/core"

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }
type Demand = { owner: string; routeIds: number[]; candidate: boolean }
export type ThroughViaDemand = Demand & { bounds: Bounds }
export type ThroughWireDemand = Demand & { axis: "x" | "y" }
type Input = {
  bounds: Bounds
  vias: ThroughViaDemand[]
  wires: ThroughWireDemand[]
  radius: number
  minimumViaSpacing: number
  slack: number
}

/** Prove a connected forbidden via column crosses the entire wire corridor. */
function blocksCrossing(
  cell: Bounds,
  first: Bounds,
  second: Bounds,
  axis: "x" | "y",
  radius: number,
  minimumSpacing: number,
  slack: number,
): boolean {
  const values = [...Object.values(cell), ...Object.values(first), ...Object.values(second), radius, minimumSpacing, slack]
  if (!values.every(Number.isFinite) || radius <= 0 || minimumSpacing <= 0 || slack < 0)
    return false
  for (const domain of [first, second]) {
    if (domain.minX > domain.maxX || domain.minY > domain.maxY ||
      domain.minX < cell.minX || domain.maxX > cell.maxX ||
      domain.minY < cell.minY || domain.maxY > cell.maxY)
      return false
  }
  const dx = Math.max(Math.abs(first.minX - second.maxX), Math.abs(first.maxX - second.minX)) + slack
  const dy = Math.max(Math.abs(first.minY - second.maxY), Math.abs(first.maxY - second.minY)) + slack
  // Their midpoint is inside the convex cell, so overlap also occurs inside it.
  if (Math.hypot(dx, dy) + slack >= 2 * radius) return false
  const transverse = axis === "x" ? dx : dy
  if (transverse >= minimumSpacing) return false
  const forcedSpan = Math.sqrt(minimumSpacing ** 2 - transverse ** 2) - slack
  const firstLow = axis === "x" ? first.minY : first.minX
  const secondLow = axis === "x" ? second.minY : second.minX
  const firstHigh = axis === "x" ? first.maxY : first.maxX
  const secondHigh = axis === "x" ? second.maxY : second.maxX
  const upperLowerBound = Math.max(firstLow, secondLow, Math.min(firstLow, secondLow) + forcedSpan)
  const lowerUpperBound = Math.min(firstHigh, secondHigh, Math.max(firstHigh, secondHigh) - forcedSpan)
  const cellLow = axis === "x" ? cell.minY : cell.minX
  const cellHigh = axis === "x" ? cell.maxY : cell.maxX
  return upperLowerBound + radius > cellHigh + slack &&
    lowerUpperBound - radius < cellLow - slack
}

/** Attribute a full-stack via crosscut to the demands that must be changed. */
export function getThroughViaCrosscutFeasibility({
  bounds, vias, wires, radius, minimumViaSpacing, slack,
}: Input): TinyHyperGraphRegionSegmentFeasibilityResult {
  for (const wire of wires) {
    for (let firstIndex = 0; firstIndex < vias.length; firstIndex++) {
      const first = vias[firstIndex]!
      if (first.owner === wire.owner) continue
      for (let secondIndex = firstIndex + 1; secondIndex < vias.length; secondIndex++) {
        const second = vias[secondIndex]!
        if (second.owner === wire.owner || second.owner === first.owner) continue
        if (!blocksCrossing(bounds, first.bounds, second.bounds, wire.axis, radius, minimumViaSpacing, slack))
          continue
        const alternatives = new Map<string, number[]>()
        for (const demand of [first, second, wire]) {
          if (demand.candidate) continue
          if (demand.routeIds.length === 0)
            throw new Error("A removable crosscut demand has no committed routes")
          const routes = [...new Set(demand.routeIds)].sort((a, b) => a - b)
          alternatives.set(JSON.stringify(routes), routes)
        }
        return alternatives.size === 0
          ? { feasible: false, blockerRouteIds: [] }
          : { feasible: false, alternativeBlockerRouteIdSets: [...alternatives.values()] }
      }
    }
  }
  return { feasible: true }
}
