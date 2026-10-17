import { expect, test } from "bun:test"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/buildHyperGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { QfpThermalPadTopologyGeneratorSolver } from "lib/solvers/QfpThermalPadTopologyGeneratorSolver/QfpThermalPadTopologyGeneratorSolver"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("thermal-pad copper remains traversable around an embedded trace target", (): void => {
  const obstacles: Obstacle[] = [
    { x: 0, y: -2.5, width: 0.4, height: 1, port: "top" },
    { x: 2.5, y: 0, width: 1, height: 0.4, port: "gnd" },
    { x: 0, y: 2.5, width: 0.4, height: 1, port: "bottom" },
    { x: -2.5, y: 0, width: 1, height: 0.4, port: "left" },
    { x: 0, y: 0, width: 1.5, height: 1.5, port: "ep" },
  ].map(({ x, y, width, height, port }) => ({
    obstacleId: `pad:${port}`,
    componentId: "u1",
    type: "rect",
    layers: ["top"],
    center: { x, y },
    width,
    height,
    connectedTo: [port],
  }))
  const inputSrj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.45,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    obstacles,
    connections: [{
      name: "ground",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pointId: "ep", pcb_port_id: "ep" },
        { x: 2.5, y: 0, layer: "top", pointId: "gnd", pcb_port_id: "gnd" },
      ],
    }],
  }
  const topologySolver = new QfpThermalPadTopologyGeneratorSolver({
    inputSrj,
    detectedComponent: {
      componentId: "u1",
      componentKind: "qfp_thermalpad",
      bounds: { __type: "rect", ...inputSrj.bounds },
    },
  })
  topologySolver.solve()

  // An existing trace endpoint inside the EP becomes an authoritative target
  // during topology merging. The surrounding EP copper has no endpoint itself.
  const traceTarget: CapacityMeshNode = {
    capacityMeshNodeId: "trace-target",
    center: { x: 0, y: 0 },
    width: 0.3,
    height: 0.3,
    layer: "z0",
    availableZ: [0],
    _containsObstacle: true,
    _containsTarget: true,
    _connectedTo: ["ep"],
  }
  const mergingSolver = new TopologyMergingSolver({
    layerCount: inputSrj.layerCount,
    nodeGroups: [
      { groupId: "global", nodes: [traceTarget], isComponent: false },
      { groupId: "u1", nodes: topologySolver.getOutput().routingRegions, isComponent: true },
    ],
  })
  mergingSolver.solve()
  const nodes = mergingSolver.getOutput()
  const edgeSolver = new CapacityMeshEdgeSolver(nodes)
  edgeSolver.solve()
  const segmentSolver = new AvailableSegmentPointSolver({
    nodes,
    edges: edgeSolver.edges,
    traceWidth: inputSrj.minTraceWidth,
    shouldReturnCrampedPortPoints: true,
  })
  segmentSolver.solve()
  const { graph, connections } = buildHyperGraph({
    capacityMeshNodes: nodes,
    segmentPortPoints: segmentSolver.getOutput().flatMap((segment) => segment.portPoints),
    layerCount: inputSrj.layerCount,
    connectivityMap: getConnectivityMapFromSimpleRouteJson(inputSrj),
    simpleRouteJsonConnections: inputSrj.connections,
  })
  const pathingSolver = new TinyHypergraphPortPointPathingSolver({
    graph,
    connections,
    layerCount: inputSrj.layerCount,
    minViaPadDiameter: inputSrj.minViaPadDiameter,
    effort: 1,
    flags: { FORCE_CENTER_FIRST: true, RIPPING_ENABLED: true },
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
  pathingSolver.solve()

  expect(pathingSolver.error).toBeNull()
  expect(pathingSolver.solved).toBe(true)
  expect(pathingSolver.failed).toBe(false)
  expect(pathingSolver.getOutput().nodesWithPortPoints.length).toBeGreaterThan(0)
  const copperPadOwners = topologySolver.getOutput().routingRegions
    .filter((node) => node._qfpRegionType === "pad" && node._containsObstacle)
    .map((node) => node._connectedTo)
    .sort((a, b) => a!.join(",").localeCompare(b!.join(",")))
  expect(copperPadOwners).toEqual([
    ["bottom"], ["ep"], ["gnd"], ["left"], ["top"],
  ])
  const freePadLayers = topologySolver.getOutput().routingRegions.filter(
    (node) => node._qfpRegionType === "pad" && !node._containsObstacle,
  )
  expect(freePadLayers.length).toBeGreaterThan(0)
  expect(freePadLayers.every((node) => node._connectedTo === undefined)).toBe(true)
})
