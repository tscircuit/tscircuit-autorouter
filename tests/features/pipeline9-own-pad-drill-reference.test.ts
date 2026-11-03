import { expect, test } from "bun:test"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("Pipeline9 distinguishes an own-pad drill overlap from connected copper", (): void => {
  const input: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.28,
    minViaHoleDiameter: 0.15,
    allowViaInPad: false,
    obstacles: [
      {
        type: "rect",
        shape: "circle",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 0.2,
        connectedTo: ["pcb_smtpad_A", "A", "start"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pcb_smtpad_A",
          pcb_port_id: "start",
        },
      },
    ],
    connections: [
      {
        name: "A",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "start" },
          { x: 0.8, y: 0, layer: "bottom", pcb_port_id: "end" },
        ],
      },
    ],
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "A_0",
    connection_name: "A",
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0.17, y: 0, width: 0.1, layer: "top" },
      {
        route_type: "via",
        x: 0.17,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.28,
        via_hole_diameter: 0.15,
      },
      { route_type: "wire", x: 0.17, y: 0, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: 0.8, y: 0, width: 0.1, layer: "bottom" },
    ],
  }
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: input,
    srjWithPointPairs: input,
  })
  const errors = evaluate([trace]).errors
  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({
    type: "pcb_placement_error",
    minimum_clearance: 0,
    pcb_trace_id: "A_0",
  })
  expect(errors[0]!.actual_clearance).toBeCloseTo(-0.005, 8)
  for (const point of trace.route) {
    if (point.route_type !== "wire" && point.route_type !== "via") continue
    if (point.x === 0.17) point.x = 0.175001
  }
  expect(evaluate([trace]).errors).toHaveLength(0)
  input.allowViaInPad = true
  const allowed = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: input,
    srjWithPointPairs: input,
  })
  const via = trace.route[2]!
  if (via.route_type !== "via") throw new Error("Expected a via")
  via.x = 0
  expect(
    allowed([trace], { includeTraceContinuity: false }).errors,
  ).toHaveLength(0)
})
