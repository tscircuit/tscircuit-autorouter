import { FlatbushIndex } from "lib/data-structures/FlatbushIndex"
import { getSegmentToObstacleDistance } from "lib/utils/getSegmentToObstacleDistance"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import type { Obstacle } from "lib/types"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HyperGraphHg } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type { NetId, SimpleRouteJson } from "lib/types"
import { createPreloadedCopperLookup } from "./createPreloadedCopperLookup"

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
  const pads = srj.obstacles.filter((obstacle) =>
    obstacle.circuitJsonMetadata?.pcb_smtpad_id || obstacle.circuitJsonMetadata?.pcb_plated_hole_id,
  )
  const padIndex = pads.length > 0 ? new FlatbushIndex<Obstacle>(pads.length) : undefined
  for (const pad of pads) {
    const radius = Math.hypot(pad.width, pad.height) / 2
    padIndex!.insert(pad, pad.center.x - radius, pad.center.y - radius,
      pad.center.x + radius, pad.center.y + radius)
  }
  padIndex?.finish()
  const margin = traceWidth / 2 + (srj.minTraceToPadEdgeClearance ?? srj.defaultObstacleMargin ?? 0.1)
  for (const port of graph.ports) {
    const fixedNetIds = new Set<NetId>()
    for (const route of getBlockers(port.d)) {
      if (!route.isFixed) continue
      fixedNetIds.add(route.rootConnectionName ?? route.connectionName)
    }
    const layer = mapZToLayerName(port.d.z, srj.layerCount)
    const padsAtCrossing = padIndex?.search(port.d.x - margin, port.d.y - margin,
      port.d.x + margin, port.d.y + margin) ?? []
    for (const pad of padsAtCrossing) {
      if (!pad.layers.includes(layer) || getSegmentToObstacleDistance({
        start: port.d, end: port.d, obstacle: pad,
      }) >= margin - 1e-9) continue
      const padId = pad.circuitJsonMetadata!.pcb_smtpad_id ?? pad.circuitJsonMetadata!.pcb_plated_hole_id!
      const padNet = pad.connectedTo.map((id) => connMap.getNetConnectedToId(id))
        .find((net) => net !== undefined)
      fixedNetIds.add(padNet ?? connMap.getNetConnectedToId(padId) ?? padId)
    }
    if (fixedNetIds.size > 0) {
      port.d._preloadedCopperNetIds = [...fixedNetIds]
    }
  }
}
