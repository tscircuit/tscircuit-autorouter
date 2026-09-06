import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import { Pipeline9HighDensityDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityDrcRepairSolver"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types/srj-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

test("Pipeline9 publishes both sides of a DRC-repaired seam and preserves downstream connectivity", (): void => {
  const leftTerminal: PortPoint = {
    x: -2,
    y: 0,
    z: 0,
    connectionName: "A",
    portPointId: "terminal-A-start",
    pcb_port_id: "A-start",
  }
  const rightTerminal: PortPoint = {
    x: 2,
    y: 0,
    z: 0,
    connectionName: "A",
    portPointId: "terminal-A-end",
    pcb_port_id: "A-end",
  }
  const seam: PortPoint = {
    x: 0,
    y: 0,
    z: 0,
    connectionName: "A",
    portPointId: "seam-A",
  }
  const nodes: NodeWithPortPoints[] = [
    {
      capacityMeshNodeId: "left-node",
      center: { x: -1, y: 0 },
      width: 2,
      height: 4,
      availableZ: [0, 1],
      portPoints: [leftTerminal, seam],
      portPointsInPairs: [[leftTerminal, seam]],
    },
    {
      capacityMeshNodeId: "right-node",
      center: { x: 1, y: 0 },
      width: 2,
      height: 4,
      availableZ: [0, 1],
      portPoints: [seam, rightTerminal],
      portPointsInPairs: [[seam, rightTerminal]],
    },
  ]
  const routes: HighDensityRoute[] = [
    {
      connectionName: "A",
      rootConnectionName: "A",
      regionId: "left-node",
      startPcbPortId: "A-start",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 0, z: 0 },
        { x: -0.5, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "A",
      rootConnectionName: "A",
      regionId: "right-node",
      startPcbPortId: "A-end",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      // Store this fragment backwards, as real HD route orientation can vary.
      route: [
        { x: 2, y: 0, z: 0 },
        { x: 0.5, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ],
      vias: [],
    },
  ]
  const originalRoutes = structuredClone(routes)
  const originalNodes = structuredClone(nodes)
  const connMap = new ConnectivityMap({
    A: ["A", "A-start", "A-end"],
    B: ["B", "B-start", "B-end"],
  })
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    obstacles: [
      {
        type: "rect",
        obstacleId: "seam-blocking-pad",
        circuitJsonMetadata: {
          pcb_smtpad_id: "pad-B-start",
          pcb_port_id: "B-start",
        },
        center: { x: 0, y: 0.27 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["B", "B-start"],
      },
    ],
    connections: [
      {
        name: "A",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pcb_port_id: "A-start" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "A-end" },
        ],
      },
      {
        name: "B",
        pointsToConnect: [
          { x: 0, y: 0.27, layer: "top", pcb_port_id: "B-start" },
          { x: 0, y: 1.5, layer: "top", pcb_port_id: "B-end" },
        ],
      },
    ],
  }
  const originalObstacles = structuredClone(srj.obstacles)
  const drcEvaluator = createPipeline9HighDensityDrcEvaluator({
    connections: [srj.connections[0]!],
    originalConnections: srj.connections,
    originalFixedHdRoutes: [],
    fixedHdRoutes: [],
    changedPreloadedTraceSections: [],
    hdRoutes: routes,
    layerCount: 2,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
    originalSrj: srj,
    srjWithPointPairs: srj,
  })
  expect(getPipeline9DrcErrors(drcEvaluator, routes).length).toBeGreaterThan(0)
  const solver = new Pipeline9HighDensityDrcRepairSolver({
    nodePortPoints: nodes,
    hdRoutes: routes,
    fixedHdRoutes: [],
    newConnections: [srj.connections[0]!],
    drcEvaluator,
    connMap,
    colorMap: {},
    obstacles: srj.obstacles,
    layerCount: 2,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    drcClearance: 0.1,
    effort: 1,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(Number(solver.stats.acceptedSeamForceRepairCount)).toBeGreaterThan(0)
  expect(solver.stats.acceptedNodeCount).toBe(2)
  expect(solver.stats.finalDrcIssueCount).toBe(0)
  const repaired = solver.getOutput()
  expect(repaired).toHaveLength(2)
  expect(getPipeline9DrcErrors(drcEvaluator, repaired)).toHaveLength(0)
  expect(repaired[0]!.regionId).toBe("left-node")
  expect(repaired[1]!.regionId).toBe("right-node")
  expect(repaired[0]!.route[0]).toEqual(routes[0]!.route[0])
  expect(repaired[1]!.route[0]).toEqual(routes[1]!.route[0])
  const leftSeam = repaired[0]!.route.at(-1)!
  const rightSeam = repaired[1]!.route.at(-1)!
  expect(leftSeam).toEqual(rightSeam)
  expect(leftSeam.x).toBe(0)
  expect(leftSeam.y).not.toBe(0)
  expect(leftSeam.z).toBe(0)
  expect(routes).toEqual(originalRoutes)
  expect(nodes).toEqual(originalNodes)
  expect(srj.obstacles).toEqual(originalObstacles)

  const stitcher = new MultipleHighDensityRouteStitchSolver3({
    connections: [srj.connections[0]!],
    hdRoutes: repaired,
    layerCount: 2,
    defaultViaDiameter: 0.3,
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
  })
  stitcher.solve()
  expect(stitcher.solved).toBe(true)
  expect(stitcher.failed).toBe(false)
  expect(stitcher.mergedHdRoutes).toHaveLength(1)
  const stitched = stitcher.mergedHdRoutes[0]!
  expect(stitched.route[0]).toMatchObject({ x: -2, y: 0, z: 0 })
  expect(stitched.route.at(-1)).toMatchObject({ x: 2, y: 0, z: 0 })
  expect(stitched.startPcbPortId).toBe("A-start")
  expect(stitched.endPcbPortId).toBe("A-end")
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "stitched-A",
    connection_name: "A",
    connectsTo: ["A-start", "A-end"],
    route: convertHdRouteToSimplifiedRoute(stitched, 2, {
      connectionPoints: srj.connections[0]!.pointsToConnect,
      obstacles: srj.obstacles,
      connMap,
      defaultViaHoleDiameter: 0.15,
    }),
  }
  // Unlike pre-stitch evaluation, this benchmark-style check includes trace
  // continuity as well as copper clearance and board-edge validation.
  expect(
    evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: [trace],
    }).errors,
  ).toHaveLength(0)
})
