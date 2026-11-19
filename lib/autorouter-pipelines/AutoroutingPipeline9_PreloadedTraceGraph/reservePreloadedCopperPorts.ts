import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HyperGraphHg } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type { NetId, SimpleRouteJson } from "lib/types"
import { createPreloadedCopperLookup } from "./createPreloadedPortValidator"

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
  const { getBlockers } = createPreloadedCopperLookup({
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
  const viaLookup = createPreloadedCopperLookup({
    srj,
    connMap,
    traceWidth: viaDiameter,
    viaDiameter,
  })
  for (const region of graph.regions) {
    const node = region.d
    let clearSiteCount = 0
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        const x = node.center.x + ((i + 0.5) / 5 - 0.5) * node.width
        const y = node.center.y + ((j + 0.5) / 5 - 0.5) * node.height
        let blocked = false
        for (let z = 0; z < srj.layerCount && !blocked; z++) {
          blocked = viaLookup
            .getBlockers({ x, y, z })
            .some((route) => route.isFixed === true)
        }
        if (!blocked) clearSiteCount++
      }
    }
    node.viaAreaFraction = Math.min(
      node.viaAreaFraction ?? 1,
      Math.max(0.1, clearSiteCount / 25),
    )
  }

}
