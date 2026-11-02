import { expect, test } from "bun:test"
import { PowerTraceExpanderSolver } from "@tscircuit/power-trace-expander"
import { PowerTraceExpansionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"
import type { SimpleRouteJson } from "lib/types"

test("power expansion preserves trace width and delegates upstream batches", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -6, minY: -5, maxX: 6, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "POWER",
        nominalTraceWidth: 0.8,
        pointsToConnect: [
          { x: -5, y: -2, layer: "top" },
          { x: 5, y: -2, layer: "top" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "power_trace",
        connection_name: "POWER",
        route: [
          { route_type: "wire", x: -5, y: -2, layer: "top", width: 0.15 },
          { route_type: "wire", x: 0, y: 1, layer: "top", width: 0.15 },
          { route_type: "wire", x: 5, y: -2, layer: "top", width: 0.15 },
        ],
      },
    ],
  }
  const options = { allowNewVias: false, onlyConnectionNames: ["POWER"] }
  const batched = new PowerTraceExpansionSolver(structuredClone(input), options)
  batched.powerTraceExpanderSolver.MAX_ITERATIONS = 16
  batched.MAX_ITERATIONS = 17
  const direct = new PowerTraceExpanderSolver(
    structuredClone(batched.powerTraceExpanderSolver.inputProblem),
    options,
  )
  direct.MAX_ITERATIONS = 16

  direct.solve()
  batched.solve()

  expect(direct.solved).toBe(true)
  expect(batched.solved).toBe(true)
  expect(batched.failed).toBe(false)
  expect(direct.getOutput()).toEqual(batched.getOutput())
  expect(batched.powerTraceExpanderSolver.iterations).toBe(direct.iterations)
  expect(batched.iterations).toBe(direct.iterations)
  const wires = batched.getOutput()[0]!.route.filter(
    (point) => point.route_type === "wire",
  )
  expect(wires).toHaveLength(5)
  expect(wires.every((point) => point.width === 0.8)).toBe(true)
})
