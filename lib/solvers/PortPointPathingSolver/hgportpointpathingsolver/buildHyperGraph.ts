import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { CapacityMeshNode, SimpleRouteConnection } from "lib/types"
import { assertDefined } from "./assertDefined"
import { checkIfConnectionPointIsInRegion } from "./checkIfConnectionPointIsInRegion"
import type { RawPort, ConnectionHg, HyperGraphHg, RegionPortHg } from "./types"

/**
 * Builds the hypergraph and connection list consumed by the HG pathing solver.
 */
export function buildHyperGraph(params: {
  simpleRouteJsonConnections: SimpleRouteConnection[]
  capacityMeshNodes: CapacityMeshNode[]
  segmentPortPoints: SegmentPortPoint[]
  layerCount: number
}): { graph: HyperGraphHg; connections: ConnectionHg[] } {
  const graph: HyperGraphHg = {
    ports: [],
    regions: [],
  }
  const connections: ConnectionHg[] = []

  for (const cmnNode of params.capacityMeshNodes) {
    graph.regions.push({
      regionId: cmnNode.capacityMeshNodeId,
      d: cmnNode,
      ports: [],
    })
  }

  for (const spp of params.segmentPortPoints) {
    const [region1Id, region2Id] = spp.nodeIds
    const region1 = graph.regions.find(
      (region) => region.regionId === region1Id,
    )
    const region2 = graph.regions.find(
      (region) => region.regionId === region2Id,
    )

    assertDefined(
      region1,
      `Could not find region with id ${region1Id} for segment port point ${spp.segmentPortPointId}`,
    )
    assertDefined(
      region2,
      `Could not find region with id ${region2Id} for segment port point ${spp.segmentPortPointId}`,
    )

    for (const z of spp.availableZ) {
      const port: RawPort = {
        portId: `${spp.segmentPortPointId}::${z}`,
        x: spp.x,
        y: spp.y,
        z,
        distToCentermostPortOnZ: 0,
        regions: [region1, region2],
      }
      const hgPort: RegionPortHg = {
        portId: spp.segmentPortPointId,
        d: port,
        region1,
        region2,
      }
      graph.ports.push(hgPort)
      region1.ports.push(hgPort)
      region2.ports.push(hgPort)
    }
  }

  for (const connection of params.simpleRouteJsonConnections) {
    const [startPoint, endPoint] = connection.pointsToConnect

    const startRegion = graph.regions.find((region) =>
      checkIfConnectionPointIsInRegion({
        point: startPoint,
        region,
        layerCount: params.layerCount,
      }),
    )
    const endRegion = graph.regions.find((region) =>
      checkIfConnectionPointIsInRegion({
        point: endPoint,
        region,
        layerCount: params.layerCount,
      }),
    )

    assertDefined(
      startRegion,
      `Could not find start region for connection "${connection.name}"`,
    )
    assertDefined(
      endRegion,
      `Could not find end region for connection "${connection.name}"`,
    )

    connections.push({
      connectionId: connection.name,
      mutuallyConnectedNetworkId:
        connection.rootConnectionName ?? connection.name,
      startRegion,
      endRegion,
      simpleRouteConnection: connection,
    })
  }

  return { graph, connections }
}
