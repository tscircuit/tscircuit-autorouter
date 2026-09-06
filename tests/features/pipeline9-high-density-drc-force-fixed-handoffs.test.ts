import { expect, test } from "bun:test"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import { Pipeline9HighDensityDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityDrcRepairSolver"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types/srj-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 forces keep untagged handoffs fixed beside immutable same-net copper", (): void => {
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "handoff-node",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [-1, -0.5, 0.5, 1].map((x) => ({ x, y: 0, z: 0 })),
    vias: [],
  }
  const handoffs: [PortPoint, PortPoint] = [
    {
      portPointId: "handoff-left",
      connectionName: "A",
      x: -1,
      y: 0,
      z: 0,
    },
    {
      portPointId: "handoff-right",
      connectionName: "A",
      x: 1,
      y: 0,
      z: 0,
    },
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "handoff-node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 4,
    availableZ: [0, 1],
    portPoints: handoffs,
    portPointsInPairs: [handoffs],
  }
  const fixedTraces: SimplifiedPcbTrace[] = [-1, 1].map((side) => ({
    type: "pcb_trace",
    pcb_trace_id: side < 0 ? "fixed-left" : "fixed-right",
    connection_name: "A",
    route: [3, 1].map((distance) => ({
      route_type: "wire",
      x: side * distance,
      y: 0,
      layer: "top",
      width: 0.4,
    })),
  }))
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    connections: [
      {
        name: "A",
        pointsToConnect: [
          { x: -3, y: 0, layer: "top", pcb_port_id: "A-start" },
          { x: 3, y: 0, layer: "top", pcb_port_id: "A-end" },
        ],
      },
      {
        name: "B",
        pointsToConnect: [
          { x: 0, y: 0.27, layer: "top", pcb_port_id: "B-start" },
          { x: 0, y: 3, layer: "top", pcb_port_id: "B-end" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0.27 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["B", "B-start"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "interior-pad",
          pcb_port_id: "B-start",
        },
      },
    ],
    traces: fixedTraces,
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const fixedHdRoutes = fixedTraces.flatMap((trace, index) =>
    convertPreloadedTraceToHdRoutes(trace, index, 2, 0.3, connMap),
  )
  const originalInputs = structuredClone({ route, node, fixedHdRoutes, srj })
  const drcEvaluator = createPipeline9HighDensityDrcEvaluator({
    connections: [srj.connections[0]!],
    originalConnections: srj.connections,
    hdRoutes: [route],
    originalFixedHdRoutes: fixedHdRoutes,
    fixedHdRoutes,
    changedPreloadedTraceSections: [],
    originalSrj: srj,
    srjWithPointPairs: srj,
    layerCount: 2,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
  })
  const initialErrors = getPipeline9DrcErrors(drcEvaluator, [route])
  expect(initialErrors).toHaveLength(1)
  expect(initialErrors[0]!.type).toBe("pcb_pad_trace_clearance_error")
  const solver = new Pipeline9HighDensityDrcRepairSolver({
    nodePortPoints: [node],
    hdRoutes: [route],
    fixedHdRoutes,
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
  const repaired = solver.getOutput()
  const finalErrors = getPipeline9DrcErrors(drcEvaluator, repaired)
  if (
    finalErrors.length > 0 ||
    Number(solver.stats.acceptedForceRepairCount) === 0
  ) {
    console.log("Pipeline9 fixed handoff force diagnostics", {
      initialErrors,
      finalErrors,
      stats: solver.stats,
    })
  }
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(Number(solver.stats.acceptedForceRepairCount)).toBeGreaterThan(0)
  expect(finalErrors).toHaveLength(0)
  expect(repaired).toHaveLength(1)
  expect(repaired[0]!.route[0]).toEqual(route.route[0])
  expect(repaired[0]!.route.at(-1)).toEqual(route.route.at(-1))
  expect(repaired[0]!.route.some((point) => point.y !== 0)).toBe(true)
  expect(repaired[0]!.startPcbPortId).toBeUndefined()
  expect(repaired[0]!.endPcbPortId).toBeUndefined()
  expect(repaired[0]!.route.every((point) => !point.pcb_port_id)).toBe(true)
  expect({ route, node, fixedHdRoutes, srj }).toEqual(originalInputs)
})
