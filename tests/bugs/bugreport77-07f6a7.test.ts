import { expect, test } from "bun:test"
import {
  AutoroutingPipelineSolver7_MultiGraph as AutoroutingPipelineSolver,
} from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport77-07f6a7/bugreport77-07f6a7.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport77 rejects connection points outside routing bounds", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toMatchInlineSnapshot(
    `"Connection "source_trace_193" point "pcb_port_306" at (25.91755920000004, -7.4452974285714335) is outside routing bounds: x [17.29280920000004, 24.19280920000004], y [-12.83529742857143, -5.935297428571431]"`,
  )
  expect(solver.preprocessSimpleRouteJsonSolver?.failed).toBe(true)
  expect(solver.portPointPathingSolver).toBeUndefined()
})
