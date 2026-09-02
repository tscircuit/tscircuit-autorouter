import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver11_Simplification } from "lib/autorouter-pipelines/AutoroutingPipeline11_Simplification/AutoroutingPipelineSolver11_Simplification"
import type { SimpleRouteJson } from "lib/types"

test("simplification pipeline preserves terminal vias", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaHoleDiameter: 0.2,
    minViaPadDiameter: 0.4,
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 4, y: 0, layer: "top" },
        ],
      },
    ],
    bounds: { minX: -1, maxX: 5, minY: -1, maxY: 1 },
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "pcb_trace_signal",
        connection_name: "signal",
        route: [
          {
            route_type: "via",
            x: 0,
            y: 0,
            from_layer: "top",
            to_layer: "bottom",
            via_diameter: 0.4,
            via_hole_diameter: 0.2,
          },
          { route_type: "wire", x: 0, y: 0, width: 0.15, layer: "top" },
          { route_type: "wire", x: 2, y: 1, width: 0.15, layer: "top" },
          { route_type: "wire", x: 4, y: 0, width: 0.15, layer: "top" },
          {
            route_type: "via",
            x: 4,
            y: 0,
            from_layer: "top",
            to_layer: "bottom",
            via_diameter: 0.4,
            via_hole_diameter: 0.2,
          },
        ],
      },
    ],
  }
  const solver = new AutoroutingPipelineSolver11_Simplification(input, {
    iterations: 1,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  const outputRoute = solver.getOutputSimplifiedPcbTraces()[0]!.route
  const outputVias = outputRoute.filter((point) => point.route_type === "via")
  const inputVias = input.traces![0]!.route.filter(
    (point) => point.route_type === "via",
  )
  expect(outputVias).toEqual(inputVias)
  expect(outputRoute[0]?.route_type).toBe("via")
  expect(outputRoute.at(-1)?.route_type).toBe("via")
})
