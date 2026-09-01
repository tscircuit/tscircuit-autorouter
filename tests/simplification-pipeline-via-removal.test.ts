import { expect, test } from "bun:test"
import { SimplificationPipelineSolver } from "lib/autorouter-pipelines/SimplificationPipeline/SimplificationPipelineSolver"
import type { SimpleRouteJson } from "lib/types"

test("simplification pipeline removes an unnecessary via pair", () => {
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
          { route_type: "wire", x: 0, y: 0, width: 0.15, layer: "top" },
          { route_type: "wire", x: 1, y: 0, width: 0.15, layer: "top" },
          {
            route_type: "via",
            x: 1,
            y: 0,
            from_layer: "top",
            to_layer: "bottom",
            via_diameter: 0.4,
            via_hole_diameter: 0.2,
          },
          {
            route_type: "wire",
            x: 1,
            y: 0,
            width: 0.15,
            layer: "bottom",
          },
          {
            route_type: "wire",
            x: 3,
            y: 0,
            width: 0.15,
            layer: "bottom",
          },
          {
            route_type: "via",
            x: 3,
            y: 0,
            from_layer: "bottom",
            to_layer: "top",
            via_diameter: 0.4,
            via_hole_diameter: 0.2,
          },
          { route_type: "wire", x: 3, y: 0, width: 0.15, layer: "top" },
          { route_type: "wire", x: 4, y: 0, width: 0.15, layer: "top" },
        ],
      },
    ],
  }
  const solver = new SimplificationPipelineSolver(input, { iterations: 1 })

  solver.solve()

  expect(solver.failed).toBe(false)
  const outputRoute = solver.getOutputSimplifiedPcbTraces()[0]!.route
  expect(outputRoute.some((point) => point.route_type === "via")).toBe(false)
  const outputWires = outputRoute.filter(
    (point) => point.route_type === "wire",
  )
  expect(outputWires.every((point) => point.layer === "top")).toBe(true)
  expect(outputWires[0]).toMatchObject({ x: 0, y: 0 })
  expect(outputWires.at(-1)).toMatchObject({ x: 4, y: 0 })
})
