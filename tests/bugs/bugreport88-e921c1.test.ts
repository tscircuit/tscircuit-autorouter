import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport88-e921c1/bugreport88-e921c1.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"

const srj = bugReport.simple_route_json as SimpleRouteJson

test.skip("bugreport88-e921c1 routes the 87-connection ESP32-P4 board", () => {
  const solver = new AutoroutingPipelineSolver(srj, { effort: 10 })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutputSimpleRouteJson().traces).toHaveLength(87)
})
