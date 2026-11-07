import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("joint repair keeps a power rail's narrow terminal sections at their original width", (): void => {
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "power",
    connection_name: "power",
    route: [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.2 },
      { route_type: "wire", x: 1, y: 0, layer: "top", width: 0.8 },
      { route_type: "wire", x: 3, y: 0, layer: "top", width: 0.2 },
      { route_type: "wire", x: 4, y: 0, layer: "top", width: 0.2 },
    ],
  }
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.45,
    minViaHoleDiameter: 0.2,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -1, maxX: 5, minY: -1, maxY: 1 },
    obstacles: [
      {
        type: "rect",
        center: { x: 0.5, y: 0.3 },
        width: 0.2,
        height: 0.1,
        layers: ["top"],
        connectedTo: ["foreign"],
      },
    ],
    connections: [
      {
        name: "power",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 4, y: 0, layer: "top" },
        ],
      },
    ],
    traces: [trace],
  }
  const signal = {
    name: "signal",
    pointsToConnect: [
      { x: 2, y: -0.8, layer: "top" },
      { x: 2, y: 0.8, layer: "top" },
    ],
  }
  input.connections.push(signal)
  for (const connection of input.connections) {
    for (const [index, point] of connection.pointsToConnect.entries()) {
      const port = `${connection.name}-port-${index}`
      point.pcb_port_id = port
      input.obstacles.push({
        type: "rect",
        center: { x: point.x, y: point.y },
        width: 0.2,
        height: 0.2,
        layers: ["top"],
        connectedTo: [connection.name, port],
      })
    }
  }
  const before = structuredClone(input)
  const solver = new Pipeline9JointDrcRepairSolver({
    srj: input,
    srjWithPointPairs: input,
    originalSrj: input,
    newConnections: [signal],
    newHdRoutes: [
      {
        connectionName: "signal",
        traceThickness: 0.1,
        viaDiameter: 0.45,
        vias: [],
        route: [
          { x: 2, y: -0.8, z: 0 },
          { x: 2, y: 0.8, z: 0 },
        ],
      },
    ],
    updatedPreloadedTraces: [trace],
    mutatedPreloadedTraceIds: new Set([trace.pcb_trace_id]),
    connMap: getConnectivityMapFromSimpleRouteJson(input),
    obstacles: input.obstacles,
    layerCount: 2,
    defaultViaDiameter: 0.45,
    defaultViaHoleDiameter: 0.2,
    effort: 1,
    colorMap: {},
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    solver.movablePreloadedSections.map(
      (section) => section.hdRoute.traceThickness,
    ),
  ).toEqual([0.2, 0.8, 0.2])
  const output = solver.getUpdatedPreloadedTraces()
  expect(output[0]!.route[0]).toMatchObject(trace.route[0]!)
  expect(output[0]!.route.at(-1)).toMatchObject(trace.route.at(-1)!)
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: input,
    srjWithPointPairs: input,
    drcOptions: { traceClearance: 0.1 },
  })
  expect(
    evaluate([
      ...output,
      ...solver.getOutput().map((route) => ({
        type: "pcb_trace" as const,
        pcb_trace_id: "signal_0",
        connection_name: "signal",
        route: convertHdRouteToSimplifiedRoute(route, 2),
      })),
    ]).errors,
  ).toEqual([])
  expect(input).toEqual(before)
})
