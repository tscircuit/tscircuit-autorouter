import { expect, test } from "bun:test"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/buildHyperGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type {
  CapacityMeshNode,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport86-40bf8e/bugreport86-40bf8e.json" with {
  type: "json",
}
import fixtureJson from "../../fixtures/bug-reports/bugreport86-40bf8e/bugreport86-40bf8e-port-point-pathing.json" with {
  type: "json",
}

type FixtureData = {
  capacityMeshNodes: CapacityMeshNode[]
  segmentPortPoints: SegmentPortPoint[]
  simpleRouteJsonConnections: SimpleRouteConnection[]
  layerCount: number
  minViaPadDiameter: number
}

test.failing(
  "port point pathing does not change layers inside nodes smaller than a via",
  (): void => {
    const fixture = fixtureJson as FixtureData
    const connectivityMap = getConnectivityMapFromSimpleRouteJson(
      bugReport.simple_route_json as SimpleRouteJson,
    )

    const { graph, connections } = buildHyperGraph({
      capacityMeshNodes: fixture.capacityMeshNodes,
      layerCount: fixture.layerCount,
      connectivityMap,
      segmentPortPoints: fixture.segmentPortPoints,
      simpleRouteJsonConnections: fixture.simpleRouteJsonConnections,
    })

    const solver = new TinyHypergraphPortPointPathingSolver({
      graph,
      connections,
      layerCount: fixture.layerCount,
      effort: 1,
      preserveTerminalPcbPortIds: true,
      minViaPadDiameter: fixture.minViaPadDiameter,
      flags: {
        FORCE_CENTER_FIRST: true,
        RIPPING_ENABLED: true,
        USE_SELECTIVE_RERIP_ROUTING: true,
      },
      weights: {
        SHUFFLE_SEED: 0,
        MEMORY_PF_FACTOR: 4,
        CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
        CENTER_OFFSET_FOCUS_SHIFT: 0,
        NODE_PF_FACTOR: 0,
        LAYER_CHANGE_COST: 0,
        RIPPING_PF_COST: 0,
        NODE_PF_MAX_PENALTY: 100,
        BASE_CANDIDATE_COST: 0.6,
        MAX_ITERATIONS_PER_PATH: 0,
        RANDOM_WALK_DISTANCE: 0,
        START_RIPPING_PF_THRESHOLD: 0.3,
        END_RIPPING_PF_THRESHOLD: 1,
        MAX_RIPS: 1000,
        RANDOM_RIP_FRACTION: 0.3,
        STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: 4,
        GREEDY_MULTIPLIER: 0.7,
        MIN_ALLOWED_BOARD_SCORE: -10000,
      },
    })

    solver.solve()

    expect(solver.error).toBeNull()
    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)

    const output = solver.getOutput()

    for (const node of output.nodesWithPortPoints) {
      const minDimension = Math.min(node.width, node.height)
      for (const [p1, p2] of node.portPointsInPairs ?? []) {
        if (p1.z !== p2.z) {
          expect(minDimension).toBeGreaterThanOrEqual(fixture.minViaPadDiameter)
        }
      }
    }
  },
)
