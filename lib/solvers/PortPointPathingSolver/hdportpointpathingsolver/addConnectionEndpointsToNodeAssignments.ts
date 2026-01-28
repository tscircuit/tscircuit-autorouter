import type { CapacityMeshNodeId, SimpleRouteConnection } from "lib/types"
import type { PortPoint } from "lib/types/high-density-types"
import type { PortPointCandidate } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"

/**
 * Add connection endpoint points to node assignments for crossing calculations.
 */
export function addConnectionEndpointsToNodeAssignments({
  path,
  connection,
  nodeAssignedPortPoints,
}: {
  path: PortPointCandidate[]
  connection: SimpleRouteConnection
  nodeAssignedPortPoints: Map<CapacityMeshNodeId, PortPoint[]>
}): void {
  if (path.length === 0) {
    return
  }

  const startCandidate = path[0]
  const endCandidate = path[path.length - 1]
  const startPoint = connection.pointsToConnect[0]
  const endPoint =
    connection.pointsToConnect[connection.pointsToConnect.length - 1]

  if (startPoint) {
    const startNodePortPoints =
      nodeAssignedPortPoints.get(startCandidate.currentNodeId) ?? []
    startNodePortPoints.push({
      x: startPoint.x,
      y: startPoint.y,
      z: startCandidate.z,
      connectionName: connection.name,
      rootConnectionName: connection.rootConnectionName,
    })
    nodeAssignedPortPoints.set(
      startCandidate.currentNodeId,
      startNodePortPoints,
    )
  }

  if (endPoint) {
    const endNodePortPoints =
      nodeAssignedPortPoints.get(endCandidate.currentNodeId) ?? []
    endNodePortPoints.push({
      x: endPoint.x,
      y: endPoint.y,
      z: endCandidate.z,
      connectionName: connection.name,
      rootConnectionName: connection.rootConnectionName,
    })
    nodeAssignedPortPoints.set(endCandidate.currentNodeId, endNodePortPoints)
  }
}
