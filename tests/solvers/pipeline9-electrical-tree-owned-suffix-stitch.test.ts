import { expect, test } from "bun:test"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/buildHyperGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("a suffix joining two prior owners exports certified interior pads through HD and stitch", (): void => {
  const a = { x: 0, y: 0, layer: "top", pcb_port_id: "A" }
  const b = { x: 30, y: 0, layer: "top", pcb_port_id: "B" }
  const c = { x: 40, y: 20, layer: "top", pcb_port_id: "C" }
  const d = { x: 32, y: 27, layer: "top", pcb_port_id: "D" }
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, maxX: 51, minY: -6, maxY: 30 },
    obstacles: [],
    connections: [
      { name: "A-B", rootConnectionName: "bus", pointsToConnect: [a, b] },
      { name: "C-B", rootConnectionName: "bus", pointsToConnect: [c, b] },
      { name: "D-A", rootConnectionName: "bus", pointsToConnect: [d, a] },
    ],
  }
  const nodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "r0",
      center: { x: 5, y: 0 },
      width: 10,
      height: 10,
      layer: "z0",
      availableZ: [0],
    },
    {
      capacityMeshNodeId: "r1",
      center: { x: 15, y: 0 },
      width: 10,
      height: 10,
      layer: "z0",
      availableZ: [0],
    },
    {
      capacityMeshNodeId: "r2",
      center: { x: 35, y: 10 },
      width: 30,
      height: 30,
      layer: "z0",
      availableZ: [0],
    },
    {
      capacityMeshNodeId: "r3",
      center: { x: 32, y: 27 },
      width: 4,
      height: 4,
      layer: "z0",
      availableZ: [0],
    },
  ]
  const connMap = getConnectivityMapFromSimpleRouteJson(input)
  const { graph, connections } = buildHyperGraph({
    simpleRouteJsonConnections: input.connections,
    capacityMeshNodes: nodes,
    segmentPortPoints: [
      { x: 10, y: 0, nodeIds: ["r0", "r1"] },
      { x: 20, y: 0, nodeIds: ["r1", "r2"] },
      { x: 32, y: 25, nodeIds: ["r2", "r3"] },
    ].map((point, index) => ({
      ...point,
      nodeIds: point.nodeIds as [string, string],
      segmentPortPointId: `boundary-${index}`,
      edgeId: `edge-${index}`,
      availableZ: [0],
      connectionName: null,
      distToCentermostPortOnZ: 0,
      cramped: false,
    })),
    layerCount: input.layerCount,
    connectivityMap: connMap,
  })
  const pathing = new TinyHypergraphPortPointPathingSolver({
    graph,
    connections,
    layerCount: input.layerCount,
    effort: 1,
    preserveTerminalPcbPortIds: true,
    flags: {
      FORCE_CENTER_FIRST: true,
      RIPPING_ENABLED: true,
      USE_SELECTIVE_RERIP_ROUTING: true,
      USE_ELECTRICAL_TREE_TARGETS: true,
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
  pathing.solve()
  expect(pathing.solved).toBe(true)
  const metrics = pathing.getSolveGraphBenchmarkMetrics()!
  expect(metrics.electricalTreeTargetCount).toBeGreaterThan(0)
  expect(metrics.electricalTreeSuffixSegmentCount).toBeGreaterThanOrEqual(4)
  expect(metrics.electricalTreeAliasConnectorCount).toBeGreaterThanOrEqual(2)
  const output = pathing.getOutput()
  const owned = output.nodesWithPortPoints.flatMap((node) => node.portPoints)
    .filter((point) => point.connectionName === "D-A")
  for (const pad of [b, c]) {
    const junctions = owned.filter((point) => point.x === pad.x && point.y === pad.y)
    expect(junctions.length).toBeGreaterThan(0)
    expect(junctions.every((point) => point.pcb_port_id === undefined)).toBe(true)
  }
  for (const endpoint of [d, a]) {
    expect(owned.some((point) => point.pcb_port_id === endpoint.pcb_port_id &&
      point.x === endpoint.x && point.y === endpoint.y && point.z === 0)).toBe(true)
  }
  const highDensity = new Pipeline9HighDensitySolver({
    nodePortPoints: output.nodesWithPortPoints,
    fixedHdRoutes: [],
    connMap,
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.6,
    traceWidth: 0.1,
    obstacleMargin: 0.1,
    effort: 1,
    enableRegionalFallback: false,
  })
  highDensity.solve()
  expect(highDensity.solved).toBe(true)
  const stitch = new MultipleHighDensityRouteStitchSolver3({
    connections: input.connections,
    hdRoutes: highDensity.routes,
    layerCount: 2,
    defaultViaDiameter: 0.6,
    preserveTerminalPcbPortIds: true,
  })
  stitch.solve()
  expect(stitch.solved).toBe(true)
  expect(stitch.mergedHdRoutes).toHaveLength(3)
  const merged = stitch.mergedHdRoutes.find((route) => route.connectionName === "D-A")!
  const ends = [merged.route[0]!, merged.route.at(-1)!]
  expect(ends.map(({ x, y, z }) => ({ x, y, z }))).toEqual(
    expect.arrayContaining([{ x: d.x, y: d.y, z: 0 }, { x: a.x, y: a.y, z: 0 }]),
  )
  expect(merged.route.every((point) =>
    point.pcb_port_id === undefined || ["D", "A"].includes(point.pcb_port_id),
  )).toBe(true)
})
