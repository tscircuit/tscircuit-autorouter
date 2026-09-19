import type { RoutingBenchmarkMetrics } from "./benchmark-types"

export const extractRerouteMetrics = (
  stats: Record<string, unknown> | undefined,
): RoutingBenchmarkMetrics["tinyHypergraphReroute"] => {
  if (stats?.reroutedRouteCount === undefined) return undefined
  const metrics = {
    rerouteAttempts: stats.rerouteAttempts,
    acceptedReroutes: stats.acceptedReroutes,
    reroutedRouteCount: stats.reroutedRouteCount,
    initialMaxRegionCost: stats.initialMaxRegionCost,
    finalMaxRegionCost: stats.finalMaxRegionCost,
    initialTotalRegionCost: stats.initialTotalRegionCost,
    finalTotalRegionCost: stats.finalTotalRegionCost,
    initialEstimatedViaCount: stats.initialEstimatedViaCount,
    finalEstimatedViaCount: stats.finalEstimatedViaCount,
    initialLayerChangeCount: stats.initialLayerChangeCount,
    finalLayerChangeCount: stats.finalLayerChangeCount,
    initialSegmentCount: stats.initialSegmentCount,
    finalSegmentCount: stats.finalSegmentCount,
  }
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Invalid tiny-hypergraph reroute metric: ${key}`)
    }
  }
  return metrics as RoutingBenchmarkMetrics["tinyHypergraphReroute"]
}
