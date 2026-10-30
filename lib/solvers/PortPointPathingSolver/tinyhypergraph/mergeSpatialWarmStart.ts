import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

type RegionAssignment = NonNullable<SerializedHyperGraph["regions"][number]["assignments"]>[number]
type SpatialRegionAssignments = { regionId: string; assignments: RegionAssignment[] }
type SpatialProposal = { assignmentsByRegion: SpatialRegionAssignments[] }
type RouteAssignment = { regionId: string; assignment: RegionAssignment }

type SpatialMergeResult = {
  assignmentsByRegion: Map<string, RegionAssignment[]>
  acceptedRoutes: number
  rejectedRoutes: number
}

/** Accept whole candidate routes in input order when their port ownership is compatible. */
export function mergeSpatialWarmStart(graph: SerializedHyperGraph, proposals: SpatialProposal[]): SpatialMergeResult {
  const connections = graph.connections ?? []
  const netByConnection = new Map(connections.map((connection) => [connection.connectionId, connection.mutuallyConnectedNetworkId ?? connection.connectionId]))
  const knownRegions = new Map(graph.regions.map((region) => [region.regionId, new Set(region.pointIds)]))
  const routes = new Map<string, RouteAssignment[]>()
  for (const proposal of proposals) {
    for (const { regionId, assignments } of proposal.assignmentsByRegion) {
      const knownPorts = knownRegions.get(regionId)
      if (!knownPorts) throw new Error(`Spatial proposal references unknown region ${regionId}`)
      for (const assignment of assignments) {
        if (!netByConnection.has(assignment.connectionId)) throw new Error(`Spatial proposal references unknown connection ${assignment.connectionId}`)
        if (!knownPorts.has(assignment.regionPort1Id) || !knownPorts.has(assignment.regionPort2Id)) throw new Error(`Spatial proposal references a port outside region ${regionId}`)
        const route = routes.get(assignment.connectionId) ?? []
        route.push({ regionId, assignment })
        routes.set(assignment.connectionId, route)
      }
    }
  }
  const portNets = new Map<string, string>()
  const assignmentsByRegion = new Map<string, RegionAssignment[]>()
  let acceptedRoutes = 0
  let rejectedRoutes = 0
  for (const connection of connections) {
    const route = routes.get(connection.connectionId)
    if (!route) continue
    const net = netByConnection.get(connection.connectionId)!
    if (route.some(({ assignment }) => [assignment.regionPort1Id, assignment.regionPort2Id].some((port) => portNets.has(port) && portNets.get(port) !== net))) {
      rejectedRoutes++
      continue
    }
    acceptedRoutes++
    for (const { regionId, assignment } of route) {
      portNets.set(assignment.regionPort1Id, net)
      portNets.set(assignment.regionPort2Id, net)
      const regionAssignments = assignmentsByRegion.get(regionId) ?? []
      regionAssignments.push(assignment)
      assignmentsByRegion.set(regionId, regionAssignments)
    }
  }
  return { assignmentsByRegion, acceptedRoutes, rejectedRoutes }
}
