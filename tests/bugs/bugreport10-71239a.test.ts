import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../examples/bug-reports/bugreport10-71239a/bugreport10-71239a.json" assert {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("solve even when we have gaps between collision nodes and straw nodes", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  expect(solver.visualize()).toMatchSnapshot(`bugreport10-71239a`)
})
