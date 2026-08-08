import { expect, test } from "bun:test"
import { TinyHypergraphRegionPathingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline10_ApproximateHypergraph/TinyHypergraphRegionPathingSolver"
import type {
  HgPortPointPathingSolverParams,
  RegionHg,
  RegionPortHg,
} from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"

test("Pipeline10 region pathing avoids heavily obstacle-occupied cells", () => {
  const regionDefinitions = [
    { regionId: "start", x: 0, y: 0, occupancy: 0 },
    { regionId: "occupied", x: 1, y: 0, occupancy: 1 },
    { regionId: "clear-detour", x: 1, y: 2, occupancy: 0 },
    { regionId: "end", x: 2, y: 0, occupancy: 0 },
  ]
  const regions: RegionHg[] = regionDefinitions.map((definition) => ({
    regionId: definition.regionId,
    d: {
      capacityMeshNodeId: definition.regionId,
      center: { x: definition.x, y: definition.y },
      width: 1,
      height: 1,
      layer: "z0",
      availableZ: [0],
      _skipEndpointNetReservation: true,
      _obstacleOccupancyFraction: definition.occupancy,
    },
    ports: [],
  }))
  const regionById = new Map(
    regions.map((region) => [region.regionId, region]),
  )
  const ports: RegionPortHg[] = []
  for (const [regionIdA, regionIdB] of [
    ["start", "occupied"],
    ["occupied", "end"],
    ["start", "clear-detour"],
    ["clear-detour", "end"],
  ] as const) {
    const region1 = regionById.get(regionIdA)!
    const region2 = regionById.get(regionIdB)!
    const portId = `${regionIdA}:${regionIdB}`
    const port: RegionPortHg = {
      portId,
      region1,
      region2,
      d: {
        portId,
        x: (region1.d.center.x + region2.d.center.x) / 2,
        y: (region1.d.center.y + region2.d.center.y) / 2,
        z: 0,
        distToCentermostPortOnZ: 0,
        regions: [region1, region2],
      },
    }
    ports.push(port)
    region1.ports.push(port)
    region2.ports.push(port)
  }
  const params: HgPortPointPathingSolverParams = {
    graph: { regions, ports },
    connections: [
      {
        connectionId: "trace",
        mutuallyConnectedNetworkId: "net",
        startRegion: regionById.get("start")!,
        endRegion: regionById.get("end")!,
        simpleRouteConnection: {
          name: "trace",
          pointsToConnect: [
            { x: 0, y: 0, layer: "top" },
            { x: 2, y: 0, layer: "top" },
          ],
        },
      },
    ],
    layerCount: 1,
    effort: 1,
    flags: { FORCE_CENTER_FIRST: true, RIPPING_ENABLED: true },
    weights: {
      SHUFFLE_SEED: 0,
      CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
      CENTER_OFFSET_FOCUS_SHIFT: 0,
      GREEDY_MULTIPLIER: 0,
      NODE_PF_FACTOR: 0,
      LAYER_CHANGE_COST: 0,
      RIPPING_PF_COST: 0,
      NODE_PF_MAX_PENALTY: 0,
      MEMORY_PF_FACTOR: 0,
      BASE_CANDIDATE_COST: 0,
      MIN_ALLOWED_BOARD_SCORE: 0,
      MAX_ITERATIONS_PER_PATH: 0,
      RANDOM_WALK_DISTANCE: 0,
      START_RIPPING_PF_THRESHOLD: 0,
      END_RIPPING_PF_THRESHOLD: 0,
      MAX_RIPS: 0,
      RANDOM_RIP_FRACTION: 0,
      STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: 0,
    },
  }
  const solver = new TinyHypergraphRegionPathingSolver({
    ...params,
    approximateObstacleOccupancyCost: 500,
  })

  solver.solve()
  const routedRegionIds = solver
    .getOutput()
    .nodesWithPortPoints.map((node) => node.capacityMeshNodeId)

  expect(routedRegionIds).toContain("clear-detour")
  expect(routedRegionIds).not.toContain("occupied")
})
