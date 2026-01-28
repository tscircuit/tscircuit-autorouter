import type { CapacityMeshNodeId, SimpleRouteConnection } from "lib/types"
import type { PortPoint } from "lib/types/high-density-types"
import type { PortPointCandidate } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"

/**
 * Assign port points for a solved path and update port point maps.
 */
export function assignPortPointsForPath({
  path,
  connection,
  assignedPortPoints,
  nodeAssignedPortPoints,
}: {
  path: PortPointCandidate[]
  connection: SimpleRouteConnection
  assignedPortPoints: Map<
    string,
    { connectionName: string; rootConnectionName?: string }
  >
  nodeAssignedPortPoints: Map<CapacityMeshNodeId, PortPoint[]>
}): PortPoint[] {
  const assigned: PortPoint[] = []

  for (const candidate of path) {
    if (!candidate.portPoint) {
      continue
    }
    const portPoint = candidate.portPoint
    assignedPortPoints.set(portPoint.portPointId, {
      connectionName: connection.name,
      rootConnectionName: connection.rootConnectionName,
    })
    const portPointAssignment: PortPoint = {
      portPointId: portPoint.portPointId,
      x: portPoint.x,
      y: portPoint.y,
      z: portPoint.z,
      connectionName: connection.name,
      rootConnectionName: connection.rootConnectionName,
    }
    assigned.push(portPointAssignment)

    for (const nodeId of portPoint.connectionNodeIds) {
      const nodePortPoints = nodeAssignedPortPoints.get(nodeId) ?? []
      nodePortPoints.push(portPointAssignment)
      nodeAssignedPortPoints.set(nodeId, nodePortPoints)
    }
  }

  return assigned
}
