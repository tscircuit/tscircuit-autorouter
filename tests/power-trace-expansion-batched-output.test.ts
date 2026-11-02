import { expect, test } from "bun:test"
import { PowerTraceExpanderSolver } from "@tscircuit/power-trace-expander"
import { PowerTraceExpansionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"
import type { SimpleRouteJson } from "lib/types"

test("batched power expansion preserves the complete child output and iteration count", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, minY: -1, maxX: 6, maxY: 1 },
    obstacles: [],
    connections: [
      {
        name: "POWER",
        nominalTraceWidth: 0.6,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 5, y: 0, layer: "top" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "power_trace",
        connection_name: "POWER",
        route: [
          { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
          { route_type: "wire", x: 5, y: 0, layer: "top", width: 0.1 },
        ],
      },
    ],
  }
  const options = { allowNewVias: false, onlyConnectionNames: ["POWER"] }
  const batched = new PowerTraceExpansionSolver(structuredClone(input), options)
  const direct = new PowerTraceExpanderSolver(
    structuredClone(batched.powerTraceExpanderSolver.inputProblem),
    options,
  )

  direct.solve()
  batched.solve()

  expect(direct.solved).toBe(true)
  expect(batched.solved).toBe(true)
  expect(batched.failed).toBe(false)
  expect(direct.getOutput()).toEqual(batched.getOutput())
  expect(batched.powerTraceExpanderSolver.iterations).toBe(direct.iterations)
  expect(batched.iterations).toBeLessThan(direct.iterations)
  expect(
    batched
      .getOutput()
      .some((trace) =>
        trace.route.some(
          (point) => point.route_type === "wire" && point.width > 0.1,
        ),
      ),
  ).toBe(true)
})
