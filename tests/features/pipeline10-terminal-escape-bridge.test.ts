import { expect, test } from "bun:test"
import { TinyHypergraphRegionPathingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline10_ApproximateHypergraph/TinyHypergraphRegionPathingSolver"
import type {
  HgPortPointPathingSolverParams,
  RegionHg,
  RegionPortHg,
} from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"

test("Pipeline10 bridges an isolated exact component terminal to the approximate mesh", () => {
  const makeRegion = (
    regionId: string,
    x: number,
    metadata: Partial<RegionHg["d"]> = {},
  ): RegionHg => ({
    regionId,
    d: {
      capacityMeshNodeId: regionId,
      center: { x, y: 0 },
      width: 1,
      height: 1,
      layer: "z0",
      availableZ: [0],
      ...metadata,
    },
    ports: [],
  })
  const pad = makeRegion("pad", 0, {
    _containsObstacle: true,
    _isComponentTopologyNode: true,
  })
  const blockedPad = makeRegion("blocked-pad", -1, {
    _containsObstacle: true,
    _isComponentTopologyNode: true,
  })
  const global = makeRegion("global", 1, {
    _skipEndpointNetReservation: true,
  })
  const end = makeRegion("end", 2, {
    _skipEndpointNetReservation: true,
  })
  const regions = [pad, blockedPad, global, end]
  const ports: RegionPortHg[] = []
  const addPort = (region1: RegionHg, region2: RegionHg, portId: string) => {
    const port: RegionPortHg = {
      portId,
      region1,
      region2,
      d: {
        portId,
        x: (region1.d.center.x + region2.d.center.x) / 2,
        y: 0,
        z: 0,
        distToCentermostPortOnZ: 0,
        regions: [region1, region2],
      },
    }
    ports.push(port)
    region1.ports.push(port)
    region2.ports.push(port)
  }
  addPort(pad, blockedPad, "component-only")
  addPort(global, end, "global-edge")
  const params: HgPortPointPathingSolverParams = {
    graph: { regions, ports },
    connections: [
      {
        connectionId: "trace",
        mutuallyConnectedNetworkId: "net",
        startRegion: pad,
        endRegion: end,
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
  const solver = new TinyHypergraphRegionPathingSolver(params)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.stats.terminalEscapeBridgeCount).toBe(1)
  expect(
    solver
      .getOutput()
      .nodesWithPortPoints.map((node) => node.capacityMeshNodeId),
  ).toEqual(expect.arrayContaining(["pad", "global", "end"]))
})
