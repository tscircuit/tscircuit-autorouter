import type { CapacityMeshNodeId, SimpleRouteConnection } from "lib/types"
import type { PortPoint } from "lib/types/high-density-types"
import type {
  InputNodeWithPortPoints,
  PortPointCandidate,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { toEndpointWithinBounds } from "lib/solvers/PortPointPathingSolver/hdportpointpathingsolver/defensive/toEndpointWithinBounds"

/**
 * Add connection endpoint points to node assignments for crossing calculations.
 */
export function addConnectionEndpointsToNodeAssignments({
  path,
  connection,
  inputNodeMap,
  nodeAssignedPortPoints,
}: {
  path: PortPointCandidate[]
  connection: SimpleRouteConnection
  inputNodeMap: Map<CapacityMeshNodeId, InputNodeWithPortPoints>
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
    const startNode = inputNodeMap.get(startCandidate.currentNodeId)
    const startPosition = toEndpointWithinBounds({
      connectionPoint: startPoint,
      candidate: startCandidate,
      node: startNode,
      endpointName: "start",
      connection,
    })
    const startNodePortPoints =
      nodeAssignedPortPoints.get(startCandidate.currentNodeId) ?? []
    startNodePortPoints.push({
      x: startPosition.x,
      y: startPosition.y,
      z: startPosition.z,
      connectionName: connection.name,
      rootConnectionName: connection.rootConnectionName,
    })
    nodeAssignedPortPoints.set(
      startCandidate.currentNodeId,
      startNodePortPoints,
    )
  }

  if (endPoint) {
    const endNode = inputNodeMap.get(endCandidate.currentNodeId)
    const endPosition = toEndpointWithinBounds({
      connectionPoint: endPoint,
      candidate: endCandidate,
      node: endNode,
      endpointName: "end",
      connection,
    })
    const endNodePortPoints =
      nodeAssignedPortPoints.get(endCandidate.currentNodeId) ?? []
    endNodePortPoints.push({
      x: endPosition.x,
      y: endPosition.y,
      z: endPosition.z,
      connectionName: connection.name,
      rootConnectionName: connection.rootConnectionName,
    })
    nodeAssignedPortPoints.set(endCandidate.currentNodeId, endNodePortPoints)
  }
}
