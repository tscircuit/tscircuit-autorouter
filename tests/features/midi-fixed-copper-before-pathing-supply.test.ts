import { expect, test } from "bun:test"
import { PreloadedTraceGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PreloadedTraceGraphSolver"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"

test("the exact MIDI single-crossing copper denies foreign top-layer supply before planning while retaining its owner and another layer", () => {
  const lower = { capacityMeshNodeId: "lower", center: { x: -39.860680999999985, y: 20.915975000000003 }, width: 0.4999999999999858, height: 1.3999999999999986, layer: "z0,1", availableZ: [0, 1] }
  const upper = { capacityMeshNodeId: "upper", center: { x: -40.1053405, y: 21.8204875 }, width: 0.9893190000000018, height: 0.4090249999999962, layer: "z0,1", availableZ: [0, 1] }
  const nodes: CapacityMeshNode[] = [lower, upper]
  const srj: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.15, minViaPadDiameter: 0.15, defaultObstacleMargin: 0.15,
    bounds: { minX: -50, maxX: 50, minY: -50, maxY: 50 }, obstacles: [],
    connections: ["foreign", "source_net_28"].map((name) => ({ name, pointsToConnect: [
      { ...lower.center, x: lower.center.x + (name === "foreign" ? 0.05 : -0.05), layer: "top", pointId: `${name}-start` },
      { ...upper.center, x: upper.center.x + (name === "foreign" ? 0.05 : -0.05), layer: "top", pointId: `${name}-end` },
    ] })),
    traces: [{ type: "pcb_trace", pcb_trace_id: "user-trace", connection_name: "source_net_28", route: [
      { route_type: "wire", x: -40.71068099999998, y: 20.915975000000003, layer: "top", width: 0.2 },
      { route_type: "wire", x: -39.12695375164908, y: 22.4997022483509, layer: "top", width: 0.2 },
    ] }],
  }
  const segment: SharedEdgeSegment = {
    edgeId: "midi-edge", nodeIds: ["lower", "upper"], start: { x: -40.11068099999998, y: 21.615975000000002 },
    end: { x: -39.61068099999999, y: 21.615975000000002 }, availableZ: [0, 1],
    portPoints: [0, 1].map((z) => ({ segmentPortPointId: `midi-port-z${z}`, edgeId: "midi-edge", nodeIds: ["lower", "upper"],
      x: -39.860680999999985, y: 21.615975000000002, availableZ: [z], connectionName: null, distToCentermostPortOnZ: 0, cramped: false })),
  }
  const preloaded = new PreloadedTraceGraphSolver([segment], srj)
  preloaded.solve()
  expect(preloaded.stats.tracePortAssignmentCount).toBe(1)
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const { graph, connections } = buildHyperGraph({
    capacityMeshNodes: nodes, segmentPortPoints: segment.portPoints, connectivityMap: connMap,
    simpleRouteJsonConnections: srj.connections, layerCount: 2,
  })
  const solver = new TinyHypergraphPortPointPathingSolver({
    graph, connections, layerCount: 2, effort: 0.1, minViaPadDiameter: 0.15,
    physicalBoundarySupply: { srj, originalSrj: srj, sharedEdgeSegments: [segment] },
    flags: { FORCE_CENTER_FIRST: true, RIPPING_ENABLED: true, USE_SELECTIVE_RERIP_ROUTING: true, USE_PREPARED_PORT_POINT_ROUTING: true },
    weights: { SHUFFLE_SEED: 0, MEMORY_PF_FACTOR: 4, CENTER_OFFSET_DIST_PENALTY_FACTOR: 0, CENTER_OFFSET_FOCUS_SHIFT: 0,
      NODE_PF_FACTOR: 0, LAYER_CHANGE_COST: 0, RIPPING_PF_COST: 0, NODE_PF_MAX_PENALTY: 100, BASE_CANDIDATE_COST: 0.6,
      MAX_ITERATIONS_PER_PATH: 0, RANDOM_WALK_DISTANCE: 0, START_RIPPING_PF_THRESHOLD: 0.3, END_RIPPING_PF_THRESHOLD: 1,
      MAX_RIPS: 1000, RANDOM_RIP_FRACTION: 0.3, STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: 4, GREEDY_MULTIPLIER: 0.7, MIN_ALLOWED_BOARD_SCORE: -10000 },
  })
  const tiny = (solver as unknown as { tinyPipelineSolver: { getInitialVisualizationSolver: () => TinyHyperGraphSolver } }).tinyPipelineSolver.getInitialVisualizationSolver()
  const top = tiny.topology.portMetadata!.findIndex((port) => port.serializedPortId === "midi-port-z0::0")
  const bottom = tiny.topology.portMetadata!.findIndex((port) => port.serializedPortId === "midi-port-z1::1")
  const foreign = tiny.problem.routeMetadata!.findIndex((route) => route.connectionId === "foreign")
  const owner = tiny.problem.routeMetadata!.findIndex((route) => route.connectionId === "source_net_28")
  expect(top).toBeGreaterThanOrEqual(0)
  expect(bottom).toBeGreaterThanOrEqual(0)
  expect(tiny.problem.routeNet[foreign]).not.toBe(tiny.problem.routeNet[owner])
  tiny.state.currentRouteNetId = tiny.problem.routeNet[foreign]
  expect(tiny.isPortReservedForDifferentNet(top)).toBe(true)
  expect(tiny.isPortReservedForDifferentNet(bottom)).toBe(false)
  tiny.state.currentRouteNetId = tiny.problem.routeNet[owner]
  expect(tiny.isPortReservedForDifferentNet(top)).toBe(false)
  solver.solve()
  expect(solver.solved).toBe(true)
  const foreignPorts = solver.getOutput().nodesWithPortPoints.flatMap((node) => node.portPoints)
    .filter((point) => point.connectionName === "foreign" && point.portPointId!.startsWith("midi-port"))
  expect(foreignPorts.length).toBeGreaterThan(0)
  expect(foreignPorts.every((point) => point.z === 1)).toBe(true)
})
