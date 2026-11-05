import type { SimpleRouteJson } from "lib/types"
import { getSrjWithImportedPadPortIds } from "./getSrjWithImportedPadPortIds"

/** Project existing physical terminal connectivity into the DRC port IDs. */
export const getExternallyConnectedPcbPortGroups = (
  srj: SimpleRouteJson,
): string[][] => {
  if (
    !srj.connections.some(
      (connection) => connection.externallyConnectedPointIds?.length,
    )
  )
    return []
  const groups: string[][] = []
  for (const connection of getSrjWithImportedPadPortIds(srj).connections) {
    if (!connection.externallyConnectedPointIds?.length) continue
    const pointsById = new Map(
      connection.pointsToConnect.map((point) => [point.pointId, point]),
    )
    for (const pointIds of connection.externallyConnectedPointIds ?? []) {
      const portIds = new Set<string>()
      for (const pointId of pointIds) {
        const point = pointsById.get(pointId)
        if (!point) {
          throw new Error(
            `Unknown externally connected point "${pointId}" in "${connection.name}"`,
          )
        }
        // The converter omits points without PCB ports from Circuit JSON.
        if (point.pcb_port_id) portIds.add(point.pcb_port_id)
      }
      if (portIds.size > 1) groups.push([...portIds])
    }
  }
  return groups
}
