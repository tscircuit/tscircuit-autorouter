import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver11_Simplification } from "lib/autorouter-pipelines/AutoroutingPipeline11_Simplification/AutoroutingPipelineSolver11_Simplification"
import type { SimpleRouteJson } from "lib/types"

test("simplification preserves fixed trace geometry and via metadata", () => {
  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [],
    bounds: { minX: -1, maxX: 5, minY: -1, maxY: 3 },
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "saved_bus",
        connection_name: "DDR_DQ0",
        isFixed: true,
        connectsTo: ["cpu_dq0", "ram_dq0"],
        route: [
          {
            route_type: "wire",
            x: 0,
            y: 0,
            width: 0.15,
            layer: "top",
            start_pcb_port_id: "cpu_dq0",
          },
          { route_type: "wire", x: 2, y: 2, width: 0.15, layer: "top" },
          { route_type: "wire", x: 4, y: 0, width: 0.15, layer: "top" },
          {
            route_type: "via",
            x: 4,
            y: 0,
            from_layer: "top",
            to_layer: "inner1",
            layers: ["top", "inner1", "inner2", "bottom"],
            via_diameter: 0.6,
            via_hole_diameter: 0.3,
          },
          {
            route_type: "wire",
            x: 4,
            y: 0,
            width: 0.15,
            layer: "inner1",
            end_pcb_port_id: "ram_dq0",
          },
        ],
      },
    ],
  }
  const originalInput = structuredClone(input)
  const solver = new AutoroutingPipelineSolver11_Simplification(input)

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.getOutputSimpleRouteJson().traces).toEqual(input.traces)
  expect(input).toEqual(originalInput)
})
