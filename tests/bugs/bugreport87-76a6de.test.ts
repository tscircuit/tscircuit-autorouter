import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport87-76a6de/bugreport87-76a6de.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test(
  "bugreport87-76a6de.json",
  () => {
    const solver = new AutoroutingPipelineSolver(srj)
    solver.solve()
    expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
      import.meta.path,
    )
  },
  { timeout: 120_000 },
)
