import type { PcbPort } from "circuit-json"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"

type PcbPortId = PcbPort["pcb_port_id"]

/** Plane escape anchors need plane geometry before reference continuity is valid. */
export function canValidatePipeline9ReferenceCopper({
  originalSrj,
  connections,
  hasNativePreloadedTraces,
}: {
  originalSrj: SimpleRouteJson
  connections: SimpleRouteConnection[]
  hasNativePreloadedTraces: boolean
}): boolean {
  const externalGroups = connections.flatMap(
    (connection) => connection.externallyConnectedPointIds ?? [],
  )
  if (!hasNativePreloadedTraces && externalGroups.length === 0) return false
  const pcbPortIds = new Set<PcbPortId>()
  for (const obstacle of originalSrj.obstacles) {
    const pcb_port_id = obstacle.circuitJsonMetadata?.pcb_port_id
    if (pcb_port_id) pcbPortIds.add(pcb_port_id)
  }
  for (const connection of originalSrj.connections) {
    for (const point of connection.pointsToConnect) {
      if (point.pcb_port_id) pcbPortIds.add(point.pcb_port_id)
    }
  }
  return externalGroups.every((group) =>
    group.every((pointId) => pcbPortIds.has(pointId)),
  )
}
