import { expect, test } from "bun:test"
import {
  PowerTraceExpansionSolver,
  type PowerTraceExpansionSolverInput,
} from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"
import type { SimplifiedPcbTrace } from "lib/types"

test("final power output and retained copper keep the original signal-layer domain", (): void => {
  const original: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "data",
    connection_name: "data",
    allowedLayers: ["top"],
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const forbidden: SimplifiedPcbTrace = {
    ...original,
    allowedLayers: undefined,
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "inner1" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "inner1" },
    ],
  }
  const input: PowerTraceExpansionSolverInput = {
    layerCount: 4,
    minTraceWidth: 0.1,
    bounds: { minX: -1, minY: -1, maxX: 2, maxY: 1 },
    obstacles: [],
    connections: [
      {
        name: "data",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
    ],
    traces: [original],
    originalPreloadedTraces: [original],
  }
  for (const onlyConnectionNames of [[], ["data"]]) {
    const solver = new PowerTraceExpansionSolver(input, { onlyConnectionNames })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(() => {
      const invalid = new PowerTraceExpansionSolver(
        { ...input, traces: [forbidden] },
        { onlyConnectionNames },
      )
      invalid.solve()
    }).toThrow("forbidden signal layer")
  }
  expect(
    () =>
      new PowerTraceExpansionSolver(
        { ...input, traces: [], fixedTraces: [forbidden] },
        { onlyConnectionNames: [] },
      ),
  ).toThrow("forbidden signal layer")
})
