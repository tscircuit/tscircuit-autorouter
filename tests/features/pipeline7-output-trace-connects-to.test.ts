import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline7 emits each solved point pair in connectsTo", () => {
  const srj = {
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [
      {
        name: "source_trace_demo",
        pointsToConnect: [
          {
            x: -2,
            y: 0,
            layer: "top",
            pointId: "pcb_port_a",
            pcb_port_id: "pcb_port_a",
          },
          {
            x: 2,
            y: 0,
            layer: "top",
            pointId: "pcb_port_b",
            pcb_port_id: "pcb_port_b",
          },
        ],
      },
    ],
  } satisfies SimpleRouteJson
  const solver = new AutoroutingPipelineSolver(srj, { cacheProvider: null })

  solver.solve()

  const output = solver.getOutputSimpleRouteJson()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(output.traces).toHaveLength(1)
  expect(output.traces?.[0]?.connectsTo).toEqual([
    "pcb_port_a",
    "pcb_port_b",
  ])
})
