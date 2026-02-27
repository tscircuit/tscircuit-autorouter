import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport18-1b2d06/bugreport18-1b2d06.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport18-1b2d06.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )

  const simplifiedTraces = solver.getOutputSimplifiedPcbTraces()
  const viaCount = simplifiedTraces
    .flatMap((trace) => trace.route)
    .filter((segment) => segment.route_type === "via").length

  // TODO: Expect no vias once via removal is fixed
  // expect(viaCount).toBeLessThan(2)
})
