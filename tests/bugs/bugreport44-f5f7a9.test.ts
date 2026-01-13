import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport44-f5f7a9/bugreport44-f5f7a9.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { getDrcErrors } from "lib/testing/getDrcErrors"

const srj = bugReport.simple_route_json as SimpleRouteJson

test(
  "bugreport44-f5f7a9.json",
  () => {
    const solver = new AutoroutingPipelineSolver(srj)
    solver.solve()

    expect(solver.solved).toBe(true)

    // Get the output traces
    const outputSrj = solver.getOutputSimpleRouteJson()
    const traces = outputSrj.traces ?? []

    // Convert to circuit JSON for DRC checking
    const circuitJson = convertToCircuitJson(srj, traces, srj.minTraceWidth)

    // Run DRC checks
    const { errors } = getDrcErrors(circuitJson)
    expect(errors.length).toBe(0)

    expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
      import.meta.path,
    )
  },
  { timeout: 30000 },
)
