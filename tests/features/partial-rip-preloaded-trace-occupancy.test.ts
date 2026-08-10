import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { CapacityMeshNode } from "lib/types"
import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"

const PRELOADED_PORT_COUNT = 102

const createSolver = (enablePartialRipWithPreloadedTraces: boolean) => {
  const capacityMeshNodes: CapacityMeshNode[] = Array.from(
    { length: PRELOADED_PORT_COUNT + 1 },
    (_, index) => ({
      capacityMeshNodeId: `node-${index}`,
      center: { x: index, y: 0 },
      width: 1,
      height: 1,
      layer: "top",
      availableZ: [0],
    }),
  )
  const segmentPortPoints = Array.from(
    { length: PRELOADED_PORT_COUNT },
    (_, index) => ({
      segmentPortPointId: `port-${index}`,
      x: index + 0.5,
      y: 0,
      availableZ: [0],
      nodeIds: [`node-${index}`, `node-${index + 1}`] as [string, string],
      edgeId: `edge-${index}`,
      connectionName: null,
      distToCentermostPortOnZ: 0,
      cramped: false,
      _preloadedFixedNetIds: ["fixed-root"],
      _preloadedTracePortAssignments: [
        {
          traceId: "fixed-trace",
          fixedNetId: "fixed-root",
          routePosition: index / (PRELOADED_PORT_COUNT - 1),
          tracePoint: { x: index + 0.5, y: 0 },
          z: 0,
        },
      ],
    }),
  )
  const { graph, connections } = buildHyperGraph({
    capacityMeshNodes,
    segmentPortPoints,
    layerCount: 1,
    connectivityMap: new ConnectivityMap({}),
    simpleRouteJsonConnections: [],
  })

  return new TinyHypergraphPortPointPathingSolver({
    graph,
    connections,
    layerCount: 1,
    effort: 0.1,
    flags: {
      FORCE_CENTER_FIRST: true,
      RIPPING_ENABLED: true,
      USE_SELECTIVE_RERIP_ROUTING: true,
      USE_PARTIAL_RIP_ROUTING_WITH_PRELOADED_TRACES:
        enablePartialRipWithPreloadedTraces,
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
}

test("Pipeline9 can use partial ripping with preloaded trace occupancy", () => {
  const getTinySolver = (
    solver: TinyHypergraphPortPointPathingSolver,
  ): TinyHyperGraphSolver =>
    (
      solver as unknown as {
        tinyPipelineSolver: {
          getInitialVisualizationSolver: () => TinyHyperGraphSolver
        }
      }
    ).tinyPipelineSolver.getInitialVisualizationSolver()

  const defaultTinySolver = getTinySolver(createSolver(false))
  const pipeline9TinySolver = getTinySolver(createSolver(true))

  expect(pipeline9TinySolver.problem.routeCount).toBe(1)
  expect(
    pipeline9TinySolver.problem.initialAssignments?.length,
  ).toBeGreaterThanOrEqual(100)
  expect(defaultTinySolver.PARTIAL_RIP_ENABLED).toBeFalse()
  expect(defaultTinySolver.OUTSIDE_IN_ROUTING).toBeFalse()
  expect(pipeline9TinySolver.PARTIAL_RIP_ENABLED).toBeTrue()
  expect(pipeline9TinySolver.OUTSIDE_IN_ROUTING).toBeTrue()
})
