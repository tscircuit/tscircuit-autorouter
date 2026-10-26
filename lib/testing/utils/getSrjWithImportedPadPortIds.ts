import type { SimpleRouteJson } from "lib/types"

/** Preserve terminal ownership when importing pads without PCB port ids. */
export function getSrjWithImportedPadPortIds(srj: SimpleRouteJson): SimpleRouteJson {
  const hasImportedPads = srj.obstacles.some((obstacle) =>
    obstacle.circuitJsonMetadata?.source_component_name &&
    obstacle.circuitJsonMetadata.source_port_name,
  )
  if (!hasImportedPads) return srj

  const hasTerminalsWithoutPcbPortIds = srj.connections.some((connection) =>
    connection.pointsToConnect.some((point) => !point.pcb_port_id && point.pointId),
  )
  if (!hasTerminalsWithoutPcbPortIds) return srj

  return {
    ...srj,
    connections: srj.connections.map((connection) => ({
      ...connection,
      pointsToConnect: connection.pointsToConnect.map((point) =>
        point.pcb_port_id || !point.pointId
          ? point
          : { ...point, pcb_port_id: point.pointId },
      ),
    })),
  }
}
