import type { AnyCircuitElement, PcbPort } from "circuit-json"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"

type PcbPortId = PcbPort["pcb_port_id"]

/** Plane escape anchors need plane geometry before reference continuity is valid. */
export function canValidatePipeline9ReferenceCopper({
  originalSrj,
  connections,
  hasNativePreloadedTraces,
  referenceCircuitJson,
}: {
  originalSrj: SimpleRouteJson
  connections: SimpleRouteConnection[]
  hasNativePreloadedTraces: boolean
  referenceCircuitJson?: readonly AnyCircuitElement[]
}): boolean {
  const externalGroups = connections.flatMap(
    (connection) => connection.externallyConnectedPointIds ?? [],
  )
  if (!hasNativePreloadedTraces && externalGroups.length === 0) {
    // Fresh routes need physical pad attachments for reference continuity.
    if (!referenceCircuitJson) return false
    const modeledPortIds = new Set<PcbPortId>()
    const padPortIds = new Set<PcbPortId>()
    for (const element of referenceCircuitJson) {
      if (element.type === "pcb_port") modeledPortIds.add(element.pcb_port_id)
      if (
        (element.type === "pcb_smtpad" || element.type === "pcb_plated_hole") &&
        element.pcb_port_id
      ) {
        padPortIds.add(element.pcb_port_id)
      }
    }
    const terminals = originalSrj.connections.flatMap(
      (connection) => connection.pointsToConnect,
    )
    return (
      terminals.length > 0 &&
      terminals.every((point) => {
        const portId = point.pcb_port_id ?? point.pointId
        return (
          portId !== undefined &&
          modeledPortIds.has(portId) &&
          padPortIds.has(portId)
        )
      })
    )
  }
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
