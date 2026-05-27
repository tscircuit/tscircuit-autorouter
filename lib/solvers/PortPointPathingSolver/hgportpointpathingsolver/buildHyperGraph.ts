import { pointToBoxDistance } from "@tscircuit/math-utils"
import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type {
  CapacityMeshNode,
  Obstacle,
  SimpleRouteConnection,
} from "lib/types"
import {
  getAssignableViaAvailableZ,
  getAssignableViaId,
  isAssignableViaObstacle,
} from "lib/autorouter-pipelines/AutoroutingPipeline8/assignableViaUtils"
import { assertDefined } from "./assertDefined"
import { checkIfConnectionPointIsInRegion } from "./checkIfConnectionPointIsInRegion"
import type {
  RawPort,
  ConnectionHg,
  HyperGraphHg,
  RegionHg,
  RegionPortHg,
} from "./types"

const GEOMETRIC_TOLERANCE = 1e-6

const getCandidateRegionsForAssignableVia = (params: {
  graph: HyperGraphHg
  point: { x: number; y: number }
  z: number
  viaRadius: number
}) => {
  const candidates = params.graph.regions
    .filter(
      (region) =>
        region.d.availableZ.includes(params.z) &&
        !(region.d as any)._assignableVia,
    )
    .map((region) => ({
      region,
      distance: pointToBoxDistance(params.point, region.d),
    }))
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        a.region.d.width * a.region.d.height -
          b.region.d.width * b.region.d.height,
    )

  const nearestDistance = candidates[0]?.distance
  if (nearestDistance === undefined) {
    return []
  }

  const maxConnectionDistance = Math.max(
    nearestDistance + GEOMETRIC_TOLERANCE,
    params.viaRadius + 0.15,
  )

  return candidates
    .filter((candidate) => candidate.distance <= maxConnectionDistance)
    .slice(0, 4)
    .map((candidate) => candidate.region)
}

const addAssignableViaRegions = (params: {
  graph: HyperGraphHg
  assignableViaObstacles: Obstacle[]
  layerCount: number
}) => {
  for (const [index, obstacle] of params.assignableViaObstacles.entries()) {
    if (!isAssignableViaObstacle(obstacle)) continue

    const availableZ = getAssignableViaAvailableZ({
      obstacle,
      layerCount: params.layerCount,
    })
    if (availableZ.length < 2) continue

    const assignableViaId = getAssignableViaId(obstacle, index)
    const viaRegionId = `assignable-via:${assignableViaId}`
    const viaRadius = Math.min(obstacle.width, obstacle.height) / 2
    const viaRegion: RegionHg = {
      regionId: viaRegionId,
      d: {
        capacityMeshNodeId: viaRegionId,
        center: { ...obstacle.center },
        width: obstacle.width,
        height: obstacle.height,
        layer: `z${availableZ.join(",")}`,
        availableZ,
        _containsObstacle: false,
        _completelyInsideObstacle: false,
        _containsTarget: false,
        _assignableVia: true,
        _assignedViaObstacle: obstacle,
      } as CapacityMeshNode,
      ports: [],
    }

    const viaPorts: RegionPortHg[] = []
    for (const z of availableZ) {
      for (const region of getCandidateRegionsForAssignableVia({
        graph: params.graph,
        point: obstacle.center,
        z,
        viaRadius,
      })) {
        const rawPort: RawPort = {
          portId: `${viaRegionId}:port:${region.regionId}:z${z}`,
          x: obstacle.center.x,
          y: obstacle.center.y,
          z,
          distToCentermostPortOnZ: 0,
          cramped: false,
          regions: [region, viaRegion],
        }
        const hgPort: RegionPortHg = {
          portId: rawPort.portId,
          d: rawPort,
          region1: region,
          region2: viaRegion,
        }
        viaPorts.push(hgPort)
        region.ports.push(hgPort)
      }
    }

    if (new Set(viaPorts.map((port) => port.d.z)).size < 2) {
      for (const port of viaPorts) {
        port.region1.ports = port.region1.ports.filter(
          (existingPort) => existingPort !== port,
        )
      }
      continue
    }

    viaRegion.ports.push(...viaPorts)
    params.graph.regions.push(viaRegion)
    params.graph.ports.push(...viaPorts)
  }
}

/**
 * Builds the hypergraph and connection list consumed by the HG pathing solver.
 */
export function buildHyperGraph(params: {
  simpleRouteJsonConnections: SimpleRouteConnection[]
  capacityMeshNodes: CapacityMeshNode[]
  segmentPortPoints: SegmentPortPoint[]
  layerCount: number
  assignableViaObstacles?: Obstacle[]
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
  const regionById = new Map(
    graph.regions.map((region) => [region.regionId, region]),
  )

  for (const spp of params.segmentPortPoints) {
    const [region1Id, region2Id] = spp.nodeIds
    const region1 = regionById.get(region1Id)
    const region2 = regionById.get(region2Id)

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
        distToCentermostPortOnZ: spp.distToCentermostPortOnZ,
        cramped: spp.cramped,
        regions: [region1, region2],
        tinyHypergraphPortPenalty: spp.tinyHypergraphPortPenalty,
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

  addAssignableViaRegions({
    graph,
    assignableViaObstacles: params.assignableViaObstacles ?? [],
    layerCount: params.layerCount,
  })

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
