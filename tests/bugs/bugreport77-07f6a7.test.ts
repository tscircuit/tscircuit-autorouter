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
  const { errors } = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    traces: solver.getOutputSimplifiedPcbTraces(),
  })

  expect(errors).toHaveLength(62)
  expect(
    errors.some(
      (error) =>
        error.type === "pcb_pad_trace_clearance_error" &&
        error.pcb_pad_id === "pcb_smtpad_215" &&
        error.pcb_trace_id === "source_trace_209__source_trace_271_mst1_0",
    ),
  ).toBe(false)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
