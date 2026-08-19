import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport88-4ab76f/bugreport88-4ab76f.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport88-4ab76f.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  if (!solver.srjWithPointPairs) throw new Error("Missing point pairs")
  const circuitJson = convertToCircuitJson(
    solver.srjWithPointPairs,
    solver.getOutputSimplifiedPcbTraces(),
    { minTraceWidth: srj.minTraceWidth },
  )

  const errors = getDrcErrors(circuitJson).errors
  const reportedPadOverlap = errors.filter(
    (error) =>
      error.type === "pcb_trace_error" &&
      error.pcb_port_ids?.includes("pcb_port_74"),
  )
  expect(reportedPadOverlap).toHaveLength(0)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(import.meta.path)
})
