import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport77-07f6a7/bugreport77-07f6a7.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport77-07f6a7.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  if (solver.failed) {
    throw new Error(`bugreport77 routing failed: ${String(solver.error)}`)
  }
  expect(solver.solved).toBe(true)
  const { errors } = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  // The rejected layer-move candidate previously left 94 reference errors.
  expect(errors.length).toBeLessThan(94)
  expect(
    errors.filter(
      (error) =>
        error.type.includes("via") || error.message?.includes("pcb_via"),
    ),
  ).toHaveLength(0)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
