import type { SolvedRoute } from "@tscircuit/hypergraph"
import type { CapacityMeshNodeId } from "lib/types"
import type { PortPoint } from "lib/types/high-density-types"
import type {
  ConnectionPathResult,
  InputNodeWithPortPoints,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { assignPortPointsForPath } from "lib/solvers/PortPointPathingSolver/hdportpointpathingsolver/assignPortPointsForPath"
import { addConnectionEndpointsToNodeAssignments } from "lib/solvers/PortPointPathingSolver/hdportpointpathingsolver/addConnectionEndpointsToNodeAssignments"
import { buildPortPointPathFromSolvedRoute } from "lib/solvers/PortPointPathingSolver/hdportpointpathingsolver/buildPortPointPathFromSolvedRoute"

/**
 * Build port point assignments from solved hypergraph routes.
 */
export function buildPortPointAssignmentsFromSolvedRoutes({
  solvedRoutes,
  connectionResults,
  inputNodes,
}: {
  solvedRoutes: SolvedRoute[]
  connectionResults: ConnectionPathResult[]
  inputNodes: InputNodeWithPortPoints[]
}): {
  connectionsWithResults: ConnectionPathResult[]
  assignedPortPoints: Map<
    string,
    { connectionName: string; rootConnectionName?: string }
  >
  nodeAssignedPortPoints: Map<CapacityMeshNodeId, PortPoint[]>
} {
  const connectionResultMap = new Map(
    connectionResults.map((result) => [result.connection.name, result]),
  )
  const assignedPortPoints = new Map<
    string,
    { connectionName: string; rootConnectionName?: string }
  >()
  const nodeAssignedPortPoints = new Map<CapacityMeshNodeId, PortPoint[]>()

  for (const node of inputNodes) {
    nodeAssignedPortPoints.set(node.capacityMeshNodeId, [])
  }

  for (const solvedRoute of solvedRoutes) {
    const connectionName = solvedRoute.connection.connectionId
    const connectionResult = connectionResultMap.get(connectionName)
    if (!connectionResult) {
      continue
    }
    const path = buildPortPointPathFromSolvedRoute({
      solvedRoute,
      connectionResult,
    })
    connectionResult.path = path
    connectionResult.portPoints = assignPortPointsForPath({
      path,
      connection: connectionResult.connection,
      assignedPortPoints,
      nodeAssignedPortPoints,
    })
    addConnectionEndpointsToNodeAssignments({
      path,
      connection: connectionResult.connection,
      nodeAssignedPortPoints,
    })
  }

  return {
    connectionsWithResults: connectionResults,
    assignedPortPoints,
    nodeAssignedPortPoints,
  }
}
