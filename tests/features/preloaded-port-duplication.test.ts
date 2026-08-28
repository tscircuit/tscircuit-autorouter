import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import {
  getSerializedPreloadedTraceStats,
  hasPreloadedTraceSectionMetadata,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/serializePreloadedTraceAssignments"
import type { CapacityMeshNode, SimpleRouteConnection } from "lib/types"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/index"

test("congestion duplicates preserve canonical preloaded assignments", () => {
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
    availableZ: [0],
  }))
  const simpleRouteJsonConnections: SimpleRouteConnection[] = [
    {
      name: "route-a",
      __rootConnectionNames: ["root-a"],
      pointsToConnect: [
        { x: -2, y: 0, layer: "top" },
        { x: 2, y: 0, layer: "top" },
      ],
    },
    {
      name: "route-b",
      __rootConnectionNames: ["root-b"],
      pointsToConnect: [
        { x: -2, y: 0.2, layer: "top" },
        { x: 2, y: 0.2, layer: "top" },
      ],
    },
  ]
  const connectivityMap = new ConnectivityMap({})
  connectivityMap.addConnections([
    ["route-a", "root-a"],
    ["route-b", "root-b"],
  ])
  const createPreloadedPort = (
    segmentPortPointId: string,
    x: number,
    nodeIds: [string, string],
    routePosition: number,
  ): SegmentPortPoint => ({
    segmentPortPointId,
    x,
    y: 0,
    availableZ: [0],
    nodeIds,
    edgeId: `${segmentPortPointId}-edge`,
    connectionName: null,
    distToCentermostPortOnZ: 0,
    cramped: false,
    _preloadedFixedNetIds: ["fixed-root"],
    _preloadedTracePortAssignments: [
      {
        traceId: "fixed-trace",
        fixedNetId: "fixed-root",
        routePosition,
        tracePoint: { x, y: 0 },
        z: 0,
      },
    ],
  })
  const { graph, connections } = buildHyperGraph({
    capacityMeshNodes,
    segmentPortPoints: [
      createPreloadedPort("west-center", -1, ["center", "west"], 0),
      createPreloadedPort("center-east", 1, ["center", "east"], 1),
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
      USE_PARTIAL_RIP_ROUTING_WITH_PRELOADED_TRACES: true,
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
  const serializedGraph = (
    solver as unknown as {
      tinyPipelineSolver: {
        inputProblem: {
          serializedHyperGraph: Parameters<
            typeof getSerializedPreloadedTraceStats
          >[0]
        }
      }
    }
  ).tinyPipelineSolver.inputProblem.serializedHyperGraph
  const sourcePortIds = new Set(["west-center::0", "center-east::0"])
  const sourcePorts = serializedGraph.ports.filter((port) =>
    sourcePortIds.has(port.portId),
  )
  const duplicatePorts = serializedGraph.ports.filter(
    (port) => typeof port.d?.duplicatedFromPortId === "string",
  )

  expect(sourcePorts).toHaveLength(2)
  expect(
    sourcePorts.every(
      (port) =>
        port.d?._preloadedFixedNetIds?.[0] === "fixed-root" &&
        port.d?._preloadedTracePortAssignments?.[0]?.traceId === "fixed-trace",
    ),
  ).toBeTrue()
  expect(duplicatePorts.length).toBeGreaterThan(0)
  expect(
    duplicatePorts.every(
      (port) =>
        port.d?._preloadedFixedNetIds === undefined &&
        port.d?._preloadedTracePortAssignments === undefined,
    ),
  ).toBeTrue()
  expect(getSerializedPreloadedTraceStats(serializedGraph)).toEqual({
    preloadedTraceCount: 1,
    preloadedPortCount: 2,
    preloadedAssignmentCount: 1,
  })

  const centerAssignments =
    serializedGraph.regions.find((region) => region.regionId === "center")
      ?.assignments ?? []
  expect(centerAssignments).toHaveLength(1)
  expect(
    new Set([
      centerAssignments[0]?.regionPort1Id,
      centerAssignments[0]?.regionPort2Id,
    ]),
  ).toEqual(sourcePortIds)
  expect(serializedGraph.solvedRoutes).toHaveLength(
    serializedGraph.connections?.length ?? 0,
  )

  const loaded = loadSerializedHyperGraph(serializedGraph)
  expect(loaded.problem.initialAssignments).toHaveLength(1)
  const preloadedRouteId = loaded.problem.initialAssignments?.[0]?.routeId
  expect(
    hasPreloadedTraceSectionMetadata(
      loaded.problem.routeMetadata?.[preloadedRouteId!],
    ),
  ).toBeTrue()

  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const output = solver.getOutput()
  expect(
    new Set(
      output.nodesWithPortPoints.flatMap((outputNode) =>
        outputNode.portPoints.flatMap((portPoint) =>
          portPoint.connectionName ? [portPoint.connectionName] : [],
        ),
      ),
    ),
  ).toEqual(new Set(["route-a", "route-b"]))
  expect(
    output.nodesWithPortPoints.some((outputNode) =>
      outputNode.portPoints.some(
        (portPoint) => typeof portPoint.duplicatedFromPortId === "string",
      ),
    ),
  ).toBeTrue()
  expect(
    output.nodesWithPortPoints.every((outputNode) =>
      outputNode.portPoints.every(
        (portPoint) =>
          portPoint.physicalPortalGroupId === undefined &&
          portPoint.physicalPortalSlotId === undefined,
      ),
    ),
  ).toBeTrue()
  expect(output.changedPreloadedTraceSections).toEqual([])
})
