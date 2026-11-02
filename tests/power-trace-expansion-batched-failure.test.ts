import { expect, test } from "bun:test"
import { PowerTraceExpansionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"
import type { SimpleRouteJson } from "lib/types"

test("batched power expansion stops on the first child failure", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, minY: -1, maxX: 2, maxY: 1 },
    obstacles: [],
    connections: [
      {
        name: "POWER",
        nominalTraceWidth: 0.6,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
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
          { route_type: "wire", x: 1, y: 0, layer: "top", width: 0.1 },
        ],
      },
    ],
  }
  const solver = new PowerTraceExpansionSolver(input, {
    onlyConnectionNames: ["POWER"],
  })
  const child = solver.powerTraceExpanderSolver
  let childStepCount = 0
  child.step = (): void => {
    childStepCount++
    child.failed = true
    child.error = "Power trace expansion test failure"
  }

  solver.step()

  expect(childStepCount).toBe(1)
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.error).toBe(child.error)
})
