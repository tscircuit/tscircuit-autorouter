import { expect, test } from "bun:test"
import { PowerTraceExpansionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"
import type { SimpleRouteJson } from "lib/types"

test("optional power expansion keeps hard-minimum copper immutable while widening another trace", (): void => {
  const input: SimpleRouteJson = {
    bounds: { minX: -4, maxX: 4, minY: -3, maxY: 3 },
    layerCount: 1,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [
      {
        name: "POWER",
        minTraceWidth: 0.4,
        nominalTraceWidth: 0.8,
        pointsToConnect: [],
      },
      { name: "SIGNAL", nominalTraceWidth: 0.2, pointsToConnect: [] },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "power",
        connection_name: "POWER",
        route: [
          { route_type: "wire", x: -2, y: 0, width: 0.4, layer: "top" },
          { route_type: "wire", x: 2, y: 0, width: 0.4, layer: "top" },
        ],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "signal",
        connection_name: "SIGNAL",
        route: [
          { route_type: "wire", x: -2, y: 1, width: 0.1, layer: "top" },
          { route_type: "wire", x: 2, y: 1, width: 0.1, layer: "top" },
        ],
      },
    ],
  }
  const original = structuredClone(input)
  const solver = new PowerTraceExpansionSolver(
    input,
    { allowNewVias: false, onlyConnectionNames: ["POWER", "SIGNAL"] },
    ["POWER"],
  )
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
  const output = solver.getOutput()
  expect(output).toHaveLength(2)
  expect(output.find((trace) => trace.connection_name === "POWER")).toEqual(
    original.traces![0],
  )
  expect(
    output
      .find((trace) => trace.connection_name === "SIGNAL")!
      .route.every(
        (point) => point.route_type !== "wire" || point.width >= 0.2 - 1e-6,
      ),
  ).toBe(true)
  expect(input).toEqual(original)
})
