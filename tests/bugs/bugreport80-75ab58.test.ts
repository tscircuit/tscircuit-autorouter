import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport80-75ab58/bugreport80-75ab58.json" with {
  type: "json",
}

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport80-75ab58.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
