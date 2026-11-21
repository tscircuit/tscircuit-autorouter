import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/buildHyperGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type {
  CapacityMeshNode,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import bugReport from "../../fixtures/bug-reports/bugreport86-40bf8e/bugreport86-40bf8e.json" with {
  type: "json",
}

type FixtureData = {
  capacityMeshNodes: CapacityMeshNode[]
  segmentPortPoints: SegmentPortPoint[]
  simpleRouteJsonConnections: SimpleRouteConnection[]
  layerCount: number
  minViaPadDiameter: number
}

export type Bugreport86PortPointPathingSetup = {
  solver: TinyHypergraphPortPointPathingSolver
  minViaPadDiameter: number
}

export function createBugreport86PortPointPathingSolver(): Bugreport86PortPointPathingSetup {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "./assets/bugreport86-port-point-pathing.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as FixtureData

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

  return {
    solver,
    minViaPadDiameter: fixture.minViaPadDiameter,
  }
}
