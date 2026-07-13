import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { HgPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import type {
  ConnectionHg,
  HyperGraphHg,
  RegionHg,
  RegionPortHg,
} from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type { CapacityMeshNode } from "lib/types"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"

const createRegion = (
  regionId: string,
  x: number,
  y: number,
  opts: { endpoint?: boolean; offBoardConnectionId?: string } = {},
): RegionHg => ({
  regionId,
  d: {
    capacityMeshNodeId: regionId,
    center: { x, y },
    width: opts.offBoardConnectionId ? 4 : 2,
    height: opts.offBoardConnectionId ? 4 : 2,
    availableZ: [0],
    _containsObstacle: opts.endpoint ?? false,
    _containsTarget: opts.endpoint ?? false,
    _offBoardConnectionId: opts.offBoardConnectionId,
  } as CapacityMeshNode,
  ports: [],
})

const connectRegions = (
  graph: HyperGraphHg,
  portId: string,
  region1: RegionHg,
  region2: RegionHg,
  x: number,
  y: number,
): RegionPortHg => {
  const port: RegionPortHg = {
    portId,
    region1,
    region2,
    d: {
      portId,
      x,
      y,
      z: 0,
      distToCentermostPortOnZ: 0,
      regions: [region1, region2],
      offBoardEndpointCapacityMeshNodeId: region1.d._offBoardConnectionId
        ? `${region2.regionId}-physical-endpoint`
        : region2.d._offBoardConnectionId
          ? `${region1.regionId}-physical-endpoint`
          : undefined,
    },
  }
  graph.ports.push(port)
  region1.ports.push(port)
  region2.ports.push(port)
  return port
}

test("topology-only hypergraph search chooses a prefab via over a crossing", () => {
  const west = createRegion("west", -2, 0, { endpoint: true })
  const east = createRegion("east", 2, 0, { endpoint: true })
  const north = createRegion("north", 0, 2, { endpoint: true })
  const south = createRegion("south", 0, -2, { endpoint: true })
  const center = createRegion("center", 0, 0)
  const prefabVia = createRegion("offboard:prefab-via", 0, 0, {
    offBoardConnectionId: "prefab-via",
  })
  const graph: HyperGraphHg = {
    regions: [west, east, north, south, center, prefabVia],
    ports: [],
  }

  connectRegions(graph, "west-center", west, center, -1, 0)
  connectRegions(graph, "east-center", east, center, 1, 0)
  connectRegions(graph, "north-center", north, center, 0, 1)
  connectRegions(graph, "south-center", south, center, 0, -1)
  connectRegions(graph, "north-via", north, prefabVia, -2, 2)
  connectRegions(graph, "via-south", prefabVia, south, 2, -2)

  const connections: ConnectionHg[] = [
    {
      connectionId: "horizontal",
      mutuallyConnectedNetworkId: "horizontal",
      startRegion: west,
      endRegion: east,
    },
    {
      connectionId: "vertical",
      mutuallyConnectedNetworkId: "vertical",
      startRegion: north,
      endRegion: south,
    },
  ]
  const solver = new HgPortPointPathingSolver({
    graph,
    connections,
    layerCount: 1,
    effort: 1,
    flags: {
      FORCE_CENTER_FIRST: false,
      RIPPING_ENABLED: true,
      MAX_OFF_BOARD_CONNECTIONS_PER_PATH: 1,
      USE_TOPOLOGY_ONLY_HEURISTIC: true,
      ALWAYS_RIP_INTERSECTIONS: true,
    },
    weights: {
      SHUFFLE_SEED: 0,
      MEMORY_PF_FACTOR: 0,
      CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
      CENTER_OFFSET_FOCUS_SHIFT: 0,
      NODE_PF_FACTOR: 100,
      LAYER_CHANGE_COST: 0,
      RIPPING_PF_COST: 0.1,
      NODE_PF_MAX_PENALTY: 100,
      BASE_CANDIDATE_COST: 0,
      TOPOLOGY_STEP_COST: 0.01,
      RIP_HISTORY_COST: 0.01,
      MAX_ITERATIONS_PER_PATH: 1_000,
      RANDOM_WALK_DISTANCE: 0,
      START_RIPPING_PF_THRESHOLD: 0.3,
      END_RIPPING_PF_THRESHOLD: 1,
      MAX_RIPS: 10,
      RANDOM_RIP_FRACTION: 0,
      STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: 0,
      GREEDY_MULTIPLIER: 1,
      MIN_ALLOWED_BOARD_SCORE: 0,
    },
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.solvedRoutes).toHaveLength(2)
  const verticalRoute = solver.solvedRoutes.find(
    (route) => route.connection.connectionId === "vertical",
  )
  expect(
    verticalRoute?.path.some((candidate) => candidate.lastRegion === prefabVia),
  ).toBe(true)

  const physicalCrossings = solver
    .getOutput()
    .nodesWithPortPoints.filter(
      (node) => node.capacityMeshNodeId !== prefabVia.regionId,
    )
    .flatMap((node) => {
      const crossings = getIntraNodeCrossingsUsingCircle(node)
      return crossings.numSameLayerCrossings > 0
        ? [node.capacityMeshNodeId]
        : []
    })
  expect(physicalCrossings).toEqual([])
  expect(
    getSvgFromGraphicsObject(solver.visualize(), { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
