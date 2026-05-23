import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver8 } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport59-82431e/bugreport59-82431e.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getAssignableViaPointKeys } from "lib/autorouter-pipelines/AutoroutingPipeline8/assignableViaUtils"
import { getXyPointKey } from "lib/autorouter-pipelines/AutoroutingPipeline8/getXyPointKey"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport59-82431e solves and emits routes", () => {
  const solver = new AutoroutingPipelineSolver8(structuredClone(srj))
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.getOutputSimplifiedPcbTraces().length).toBeGreaterThan(0)
}, 30_000)

test("bugreport59-82431e keeps effort 2 vias on preplaced assignable vias", () => {
  const solver = new AutoroutingPipelineSolver8(structuredClone(srj), {
    effort: 2,
  })
  solver.solve()

  const allowedViaPointKeys = getAssignableViaPointKeys(srj.obstacles)
  const outputVias = solver
    .getOutputSimplifiedPcbTraces()
    .flatMap((trace) =>
      trace.route.filter((segment) => segment.route_type === "via"),
    )

  expect(outputVias.length).toBeGreaterThan(0)
  expect(
    outputVias.filter((via) => !allowedViaPointKeys.has(getXyPointKey(via))),
  ).toEqual([])
}, 30_000)
