import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HyperGraphHg } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type { NetId, SimpleRouteJson } from "lib/types"
import { createPreloadedPortBlockerLookup } from "./createPreloadedPortValidator"

/**
 * Reserve graph crossings within immutable copper's clearance envelope.
 * Points are board-world mm (+X right, +Y up); Z identifies the copper layer.
 * Trace paths and their existing graph assignments are retained unchanged.
 */
export function reservePreloadedCopperPorts({
  graph,
  srj,
  connMap,
  traceWidth,
  viaDiameter,
}: {
  graph: HyperGraphHg
  srj: SimpleRouteJson
  connMap: ConnectivityMap
  traceWidth: number
  viaDiameter: number
}): void {
  if (!srj.traces?.some((trace) => trace.isFixed)) return
  const getBlockers = createPreloadedPortBlockerLookup({
    srj,
    connMap,
    traceWidth,
    viaDiameter,
  })
  for (const port of graph.ports) {
    const fixedNetIds = new Set<NetId>()
    for (const route of getBlockers(port.d)) {
      if (!route.isFixed) continue
      fixedNetIds.add(route.rootConnectionName ?? route.connectionName)
    }
    if (fixedNetIds.size > 0) {
      port.d._preloadedCopperNetIds = [...fixedNetIds]
    }
  }
}
