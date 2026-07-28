import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { CapacityMeshNode, SimpleRouteConnection } from "lib/types"
import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"

test("serialized preloaded assignments occupy existing hypergraph regions", () => {
  const capacityMeshNodes: CapacityMeshNode[] = [
    ["west", -2, 0],
    ["center", 0, 0],
    ["east", 2, 0],
    ["north", 0, 2],
    ["south", 0, -2],
  ].map(([capacityMeshNodeId, x, y]) => ({
    capacityMeshNodeId: String(capacityMeshNodeId),
    center: { x: Number(x), y: Number(y) },
    width: 2,
    height: 2,
    layer: "top",
    availableZ: [0],
  }))
  const simpleRouteJsonConnections: SimpleRouteConnection[] = [
    {
      name: "foreign-route",
      __rootConnectionNames: ["foreign-root"],
      pointsToConnect: [
        { x: 0, y: 2, layer: "top" },
        { x: 0, y: -2, layer: "top" },
      ],
    },
  ]
  const connectivityMap = new ConnectivityMap({})
  connectivityMap.addConnections([["foreign-route", "foreign-root"]])
  const createPort = (
    segmentPortPointId: string,
    x: number,
    y: number,
    nodeIds: [string, string],
    routePosition?: number,
  ) => ({
    segmentPortPointId,
    x,
    y,
    availableZ: [0],
    nodeIds,
    edgeId: `${segmentPortPointId}-edge`,
    connectionName: null,
    distToCentermostPortOnZ: 0,
    cramped: false,
    ...(routePosition === undefined
      ? {}
      : {
          _preloadedFixedNetIds: ["fixed-root"],
          _preloadedTracePortAssignments: [
            {
              traceId: "fixed-trace",
              fixedNetId: "fixed-root",
              routePosition,
              z: 0,
            },
          ],
        }),
  })
  const { graph, connections } = buildHyperGraph({
    capacityMeshNodes,
    segmentPortPoints: [
      createPort("west-center", -1, 0, ["west", "center"], 0),
      createPort("center-east", 1, 0, ["center", "east"], 1),
      createPort("north-center", 0, 1, ["north", "center"]),
      createPort("center-south", 0, -1, ["center", "south"]),
    ],
    layerCount: 1,
    connectivityMap,
    simpleRouteJsonConnections,
  })
  const solver = new TinyHypergraphPortPointPathingSolver({
    graph,
    connections,
    layerCount: 1,
    effort: 0.1,
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
  const tinyPipeline = (
    solver as unknown as {
      tinyPipelineSolver: {
        getInitialVisualizationSolver: () => TinyHyperGraphSolver
      }
    }
  ).tinyPipelineSolver
  const tinySolver = tinyPipeline.getInitialVisualizationSolver()
  const centerRegionId = tinySolver.topology.regionMetadata?.findIndex(
    (metadata) => metadata.capacityMeshNodeId === "center",
  )
  const getPortId = (serializedPortId: string) =>
    tinySolver.topology.portMetadata?.findIndex(
      (metadata) => metadata.serializedPortId === serializedPortId,
    ) ?? -1
  const westPortId = getPortId("west-center::0")
  const eastPortId = getPortId("center-east::0")

  expect(tinySolver.topology.regionCount).toBe(capacityMeshNodes.length + 2)
  expect(centerRegionId).toBeGreaterThanOrEqual(0)
  expect(
    tinySolver.state.regionIntersectionCaches[centerRegionId!]
      .existingSegmentCount,
  ).toBe(1)
  const [[preloadedRouteId, preloadedFromPortId, preloadedToPortId]] =
    tinySolver.state.regionSegments[centerRegionId!]
  expect(
    tinySolver.problem.routeMetadata?.[
      preloadedRouteId
    ]?.connectionId?.startsWith("__tscircuit_preloaded_trace__:"),
  ).toBe(true)
  expect(
    [preloadedFromPortId, preloadedToPortId].sort((a, b) => a - b),
  ).toEqual([westPortId, eastPortId].sort((a, b) => a - b))

  tinySolver.resetRoutingStateForRerip()

  expect(tinySolver.state.regionSegments[centerRegionId!]).toEqual([
    [preloadedRouteId, preloadedFromPortId, preloadedToPortId],
  ])
  expect(tinySolver.state.unroutedRoutes).not.toContain(preloadedRouteId)
})
