import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { CapacityMeshNode } from "lib/types"
import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"

test("a preload without a serialized section cannot shift another physical net's region ownership", () => {
  const connectivityMap = new ConnectivityMap({})
  connectivityMap.addConnections([["unrepresented-net"], ["represented-net"]])
  const unrepresentedNetId = connectivityMap.getNetConnectedToId("unrepresented-net")!
  const representedNetId = connectivityMap.getNetConnectedToId("represented-net")!
  const capacityMeshNodes: CapacityMeshNode[] = [
    ["unrepresented-pad", -8, "unrepresented-net"],
    ["unrepresented-open", -6, undefined],
    ["represented-west-pad", -2, "represented-net"],
    ["represented-open", 0, undefined],
    ["represented-east-pad", 2, "represented-net"],
  ].map(([id, x, owner]) => ({
    capacityMeshNodeId: String(id), center: { x: Number(x), y: 0 },
    width: 2, height: 2, layer: "top", availableZ: [0],
    ...(owner ? { _containsObstacle: true, _containsTarget: true, _connectedTo: [String(owner)] } : {}),
  }))
  const createPort = (
    id: string, x: number, nodeIds: [string, string], traceId: string,
    fixedNetId: string, routePosition: number,
  ): SegmentPortPoint => ({
    segmentPortPointId: id, x, y: 0, nodeIds, availableZ: [0],
    edgeId: `${id}-edge`, connectionName: null, distToCentermostPortOnZ: 0,
    cramped: false, _preloadedFixedNetIds: [fixedNetId],
    _preloadedTracePortAssignments: [{ traceId, fixedNetId, routePosition, tracePoint: { x, y: 0 }, z: 0 }],
  })
  const { graph, connections } = buildHyperGraph({
    capacityMeshNodes, connectivityMap, layerCount: 1, simpleRouteJsonConnections: [],
    segmentPortPoints: [
      createPort("unrepresented", -7, ["unrepresented-pad", "unrepresented-open"], "short-trace", unrepresentedNetId, 0.5),
      createPort("represented-west", -1, ["represented-west-pad", "represented-open"], "long-trace", representedNetId, 0.25),
      createPort("represented-east", 1, ["represented-open", "represented-east-pad"], "long-trace", representedNetId, 0.75),
    ],
  })
  const solver = new TinyHypergraphPortPointPathingSolver({
    graph, connections, layerCount: 1, effort: 0.1,
    flags: { FORCE_CENTER_FIRST: true, RIPPING_ENABLED: true, USE_SELECTIVE_RERIP_ROUTING: true },
    weights: {
      SHUFFLE_SEED: 0, MEMORY_PF_FACTOR: 4, CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
      CENTER_OFFSET_FOCUS_SHIFT: 0, NODE_PF_FACTOR: 0, LAYER_CHANGE_COST: 0,
      RIPPING_PF_COST: 0, NODE_PF_MAX_PENALTY: 100, BASE_CANDIDATE_COST: 0.6,
      MAX_ITERATIONS_PER_PATH: 0, RANDOM_WALK_DISTANCE: 0, START_RIPPING_PF_THRESHOLD: 0.3,
      END_RIPPING_PF_THRESHOLD: 1, MAX_RIPS: 1000, RANDOM_RIP_FRACTION: 0.3,
      STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: 4, GREEDY_MULTIPLIER: 0.7, MIN_ALLOWED_BOARD_SCORE: -10000,
    },
  })
  const tiny = (solver as unknown as {
    tinyPipelineSolver: { getInitialVisualizationSolver: () => TinyHyperGraphSolver }
  }).tinyPipelineSolver.getInitialVisualizationSolver()
  expect(tiny.problem.routeCount).toBe(1)
  expect(tiny.problem.initialAssignments).toHaveLength(1)
  expect(tiny.problem.routeMetadata![0]!.preloadedTraceSection.traceId).toBe("long-trace")
  const representedRouteNet = tiny.problem.routeNet[0]!
  const ownedRegions = new Map(tiny.topology.regionMetadata!.map((region, regionId) =>
    [region.capacityMeshNodeId, tiny.problem.regionNetId[regionId]],
  ))
  expect(ownedRegions.get("represented-west-pad")).toBe(representedRouteNet)
  expect(ownedRegions.get("represented-east-pad")).toBe(representedRouteNet)
  expect(ownedRegions.get("unrepresented-pad")).toBeGreaterThanOrEqual(0)
  expect(ownedRegions.get("unrepresented-pad")).not.toBe(representedRouteNet)
})
