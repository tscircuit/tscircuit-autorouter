import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import { getCurrentCircuitJson } from "lib/testing/autorouting-pipeline-debugger/getCurrentCircuitJson"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport66-e6c7e0/bugreport66-e6c7e0.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport66-e6c7e0.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )

  const circuitJson = getCurrentCircuitJson(solver)
  expect(circuitJson).not.toBeNull()
  const { errors } = getDrcErrors(circuitJson!)
  const errorsForPcbPort115 = errors.filter(
    (error) =>
      "pcb_port_ids" in error &&
      Array.isArray(error.pcb_port_ids) &&
      error.pcb_port_ids.includes("pcb_port_115"),
  )
  expect(errorsForPcbPort115).toEqual([])
}, 300_000)
