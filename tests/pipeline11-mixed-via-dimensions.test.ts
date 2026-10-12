import { expect, test } from "bun:test"
import { PrepareTraceSimplificationSolver } from "../lib/autorouter-pipelines/AutoroutingPipeline11_Simplification/PrepareTraceSimplificationSolver"
import { ApplyTraceSimplificationSolver } from "../lib/autorouter-pipelines/AutoroutingPipeline11_Simplification/ApplyTraceSimplificationSolver"
import type { SimpleRouteJson } from "../lib/types"

test("preparing and applying unchanged routes preserves internal via dimensions", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.2,
    bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 6, y: 0, layer: "top" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "trace1",
        connection_name: "signal",
        route: [
          { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.2 },
          { route_type: "wire", x: 2, y: 0, layer: "top", width: 0.2 },
          {
            route_type: "via",
            x: 2,
            y: 0,
            from_layer: "top",
            to_layer: "bottom",
            via_diameter: 0.6,
            via_hole_diameter: 0.3,
          },
          { route_type: "wire", x: 2, y: 0, layer: "bottom", width: 0.2 },
          { route_type: "wire", x: 4, y: 0, layer: "bottom", width: 0.2 },
          {
            route_type: "via",
            x: 4,
            y: 0,
            from_layer: "bottom",
            to_layer: "top",
            via_diameter: 1.0,
            via_hole_diameter: 0.5,
          },
          { route_type: "wire", x: 4, y: 0, layer: "top", width: 0.2 },
          { route_type: "wire", x: 6, y: 0, layer: "top", width: 0.2 },
        ],
      },
    ],
  }
  const prepare = new PrepareTraceSimplificationSolver({
    inputSrj: input,
    options: {},
  })
  prepare.solve()
  const preparedInput = prepare.getOutput()
  const apply = new ApplyTraceSimplificationSolver({
    preparedInput,
    simplifiedHdRoutes: preparedInput.mutableHdRoutes,
  })
  apply.solve()
  const dimensions = apply
    .getOutput()
    .traces![0]!.route.filter((point) => point.route_type === "via")
    .map((point) => [point.via_diameter, point.via_hole_diameter])
  expect(dimensions).toEqual([
    [0.6, 0.3],
    [1.0, 0.5],
  ])
})
