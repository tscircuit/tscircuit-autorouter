import { expect, test } from "bun:test"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("reproduce Pipeline9 ignoring the independent trace clearance", (): void => {
  // Board-world XY positions in mm, +Y up. The middle copper gap is 0.075 mm.
  const routedTraces: SimplifiedPcbTrace[] = [-1, 1].map((side, index) => ({
    type: "pcb_trace", pcb_trace_id: `trace_${index}`, connection_name: `net_${index}`,
    route: [-2, -1, 1, 2].map((x) => ({
      route_type: "wire", x, y: (index === 0 ? 0 : 0.175) + (Math.abs(x) === 2 ? side * 0.5 : 0),
      width: 0.1, layer: "top",
    })),
  }))
  const input: SimpleRouteJson & { minDifferentNetTraceEdgeToTraceEdgeClearance: number } = {
    layerCount: 2, minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.05,
    minDifferentNetTraceEdgeToTraceEdgeClearance: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -1, maxY: 1.5 },
    obstacles: [{
      type: "rect", center: { x: 0, y: -0.225 }, width: 0.2, height: 0.2,
      layers: ["top"], connectedTo: ["foreign"],
      circuitJsonMetadata: { pcb_smtpad_id: "foreign_pad" },
    }],
    connections: routedTraces.map((trace) => ({
      name: trace.connection_name!,
      pointsToConnect: [trace.route[0]!, trace.route.at(-1)!].map((point, index) => ({
        x: point.x, y: point.y, layer: "top", pcb_port_id: `${trace.connection_name}_${index}`,
      })),
    })),
  }
  for (const connection of input.connections) {
    for (const point of connection.pointsToConnect) {
      input.obstacles.push({
        type: "rect", center: { x: point.x, y: point.y }, width: 0.2, height: 0.2,
        layers: ["top"], connectedTo: [connection.name, point.pcb_port_id!],
        circuitJsonMetadata: { pcb_port_id: point.pcb_port_id, pcb_smtpad_id: `pad_${point.pcb_port_id}` },
      })
    }
  }
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: input, srjWithPointPairs: input,
    drcOptions: { traceClearance: input.minTraceToPadEdgeClearance },
  })
  // The declared trace-pair rule is ignored, so this records the current bug.
  expect(evaluate(routedTraces).errors).toHaveLength(0)
  expect(getBugReportSnapshotSvg({
    inputSrj: input, srjWithPointPairs: input, routedTraces,
    drcOptions: { traceClearance: input.minTraceToPadEdgeClearance },
  })).toMatchSvgSnapshot(import.meta.path)
})
