import { expect, test } from "bun:test";
import { ConnectivityMap } from "circuit-json-to-connectivity-map";
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver";
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver";
import type { CapacityMeshNode } from "lib/types";
import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index";

test("Pipeline9 exposes an accepted preloaded hypergraph route change", () => {
  const capacityMeshNodes: CapacityMeshNode[] = [
    ["west", -2],
    ["center", 0],
    ["east", 2],
  ].map(([capacityMeshNodeId, x]) => ({
    capacityMeshNodeId: String(capacityMeshNodeId),
    center: { x: Number(x), y: 0 },
    width: 2,
    height: 2,
    layer: "top",
    availableZ: [0, 1],
  }));
  const createPreloadedPort = (
    segmentPortPointId: string,
    x: number,
    nodeIds: [string, string],
    routePosition: number,
  ) => ({
    segmentPortPointId,
    x,
    y: 0,
    availableZ: [0, 1],
    nodeIds,
    edgeId: `${segmentPortPointId}-edge`,
    connectionName: null,
    distToCentermostPortOnZ: 0,
    cramped: false,
    _preloadedFixedNetIds: ["preloaded-root"],
    _preloadedTracePortAssignments: [
      {
        traceId: "pcb_trace_preloaded_horizontal",
        fixedNetId: "preloaded-root",
        routePosition,
        tracePoint: { x, y: 0.4 },
        z: 0,
      },
    ],
  });
  const { graph, connections } = buildHyperGraph({
    capacityMeshNodes,
    segmentPortPoints: [
      createPreloadedPort("west-center", -1, ["west", "center"], 0.25),
      createPreloadedPort("center-east", 1, ["center", "east"], 0.75),
    ],
    layerCount: 2,
    connectivityMap: new ConnectivityMap({}),
    simpleRouteJsonConnections: [],
  });
  const solver = new TinyHypergraphPortPointPathingSolver({
    graph,
    connections,
    layerCount: 2,
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
  });

  solver.solve();
  const tinySolver = (
    solver as unknown as {
      tinyPipelineSolver: { getSolvedTinySolver: () => TinyHyperGraphSolver };
    }
  ).tinyPipelineSolver.getSolvedTinySolver();
  const preloadedRouteId = tinySolver.problem.routeMetadata?.findIndex(
    (metadata) => metadata.preloadedTraceSection !== undefined,
  );
  const centerRegionId = tinySolver.topology.regionMetadata?.findIndex(
    (metadata) => metadata.capacityMeshNodeId === "center",
  );
  const getPortId = (serializedPortId: string) =>
    tinySolver.topology.portMetadata?.findIndex(
      (metadata) => metadata.serializedPortId === serializedPortId,
    );
  const westPortOnBottom = getPortId("west-center::1");
  const eastPortOnBottom = getPortId("center-east::1");
  if (
    preloadedRouteId === undefined ||
    preloadedRouteId < 0 ||
    centerRegionId === undefined ||
    centerRegionId < 0 ||
    westPortOnBottom === undefined ||
    westPortOnBottom < 0 ||
    eastPortOnBottom === undefined ||
    eastPortOnBottom < 0
  ) {
    throw new Error("Test hypergraph is missing preloaded route metadata");
  }
  tinySolver.state.regionSegments = tinySolver.state.regionSegments.map(
    (segments) => segments.filter(([routeId]) => routeId !== preloadedRouteId),
  );
  tinySolver.state.regionSegments[centerRegionId]!.push([
    preloadedRouteId,
    westPortOnBottom,
    eastPortOnBottom,
  ]);

  const output = solver.getOutput();
  expect(output.changedPreloadedTraceSections).toEqual([
    expect.objectContaining({
      traceId: "pcb_trace_preloaded_horizontal",
      startRoutePosition: 0.25,
      endRoutePosition: 0.75,
      connection: expect.objectContaining({
        pointsToConnect: [
          { x: -1, y: 0.4, layer: "top" },
          { x: 1, y: 0.4, layer: "top" },
        ],
      }),
    }),
  ]);
  const materializedConnectionName =
    output.changedPreloadedTraceSections[0]!.connectionName;
  expect(
    output.nodesWithPortPoints.some((node) =>
      node.portPoints.some(
        (portPoint) =>
          portPoint.connectionName === materializedConnectionName &&
          portPoint.z === 1,
      ),
    ),
  ).toBeTrue();
});
