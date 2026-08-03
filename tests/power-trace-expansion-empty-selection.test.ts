import { expect, test } from "bun:test"
import { PowerTraceExpansionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"
import type { SimpleRouteJson } from "lib/types"

test("PowerTraceExpansionSolver immediately bypasses an empty selection", () => {
  const traces = [
    {
      type: "pcb_trace" as const,
      pcb_trace_id: "trace_1",
      connection_name: "SIGNAL",
      route: [
        { route_type: "wire" as const, x: 0, y: 0, layer: "top", width: 0.1 },
        { route_type: "wire" as const, x: 1, y: 0, layer: "top", width: 0.1 },
      ],
    },
  ]
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, minY: -1, maxX: 2, maxY: 1 },
    obstacles: [],
    connections: [
      {
        name: "SIGNAL",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
    ],
    traces,
  }

  const solver = new PowerTraceExpansionSolver(inputSrj, {
    onlyConnectionNames: [],
  })

  expect(solver.solved).toBe(true)
  expect(solver.iterations).toBe(0)
  expect(solver.stats).toEqual({ selectedTraceCount: 0, bypassed: true })
  expect(solver.getOutput()).toEqual(traces)
  expect(solver.getOutput()).not.toBe(traces)
})
