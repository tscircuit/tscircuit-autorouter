import { expect, test } from "bun:test"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { Pipeline9ClearanceProjectionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionSolver"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"

test("Pipeline9 checks independent trace clearance without rejecting valid pad gaps", (): void => {
  // Board-world XY positions in mm, +Y up. The middle copper gap is 0.075 mm.
  const routedTraces = [-1, 1].map((side, index) => ({
    type: "pcb_trace",
    pcb_trace_id: `trace_${index}`,
    connection_name: `net_${index}`,
    route: [-2, -1, 1, 2].map((x) => ({
      route_type: "wire",
      x,
      y: (index === 0 ? 0 : 0.175) + (Math.abs(x) === 2 ? side * 0.5 : 0),
      width: 0.1,
      layer: "top",
    })),
  })) satisfies SimplifiedPcbTrace[]
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.05,
    minDifferentNetTraceEdgeToTraceEdgeClearance: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -1, maxY: 1.5 },
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: -0.225 },
        width: 0.2,
        height: 0.2,
        layers: ["top"],
        connectedTo: ["foreign"],
        circuitJsonMetadata: { pcb_smtpad_id: "foreign_pad" },
      },
    ],
    connections: routedTraces.map((trace) => ({
      name: trace.connection_name!,
      pointsToConnect: [trace.route[0]!, trace.route.at(-1)!].map(
        (point, index) => ({
          x: point.x,
          y: point.y,
          layer: "top",
          pcb_port_id: `${trace.connection_name}_${index}`,
        }),
      ),
    })),
  }
  for (const connection of input.connections) {
    for (const point of connection.pointsToConnect) {
      input.obstacles.push({
        type: "rect",
        center: { x: point.x, y: point.y },
        width: 0.2,
        height: 0.2,
        layers: ["top"],
        connectedTo: [connection.name, point.pcb_port_id!],
        circuitJsonMetadata: {
          pcb_port_id: point.pcb_port_id,
          pcb_smtpad_id: `pad_${point.pcb_port_id}`,
        },
      })
    }
  }
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: input,
    srjWithPointPairs: input,
    drcOptions: { traceClearance: input.minTraceToPadEdgeClearance },
  })
  expect(evaluate(routedTraces).errors).toHaveLength(1)
  const routes: HighDensityRoute[] = routedTraces.map((trace) => ({
    connectionName: trace.connection_name!,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: trace.route.map((point) => ({ x: point.x, y: point.y, z: 0 })),
  }))
  const drcEvaluator: DrcEvaluator = ({
    routes: candidateRoutes,
  }): ReturnType<DrcEvaluator> => {
    if (!candidateRoutes) throw new Error("Expected projected wire routes")
    const json = convertToCircuitJson(input, candidateRoutes)
    return getDrcErrors(json, {
      traceClearance: 0.05,
      differentNetTraceClearance: 0.1,
    }) as unknown as ReturnType<DrcEvaluator>
  }
  const solver = new Pipeline9ClearanceProjectionSolver({
    originalSrj: input,
    routes,
    drcEvaluator,
    usePrecisionMargin: true,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const repaired: SimplifiedPcbTrace[] = solver
    .getOutput()
    .map((route, index) => ({
      ...routedTraces[index]!,
      route: route.route.map((point) => ({
        route_type: "wire",
        x: point.x,
        y: point.y,
        width: route.traceThickness,
        layer: "top",
      })),
    }))
  expect(evaluate(repaired).errors).toEqual([])
  for (const [index, trace] of repaired.entries()) {
    expect(trace.route[0]).toEqual(routedTraces[index]!.route[0])
    expect(trace.route.at(-1)).toEqual(routedTraces[index]!.route.at(-1))
  }
  expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: input,
      routedTraces: repaired,
      drcOptions: { traceClearance: input.minTraceToPadEdgeClearance },
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
