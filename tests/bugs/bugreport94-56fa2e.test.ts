import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import { getCurrentCircuitJson } from "lib/testing/autorouting-pipeline-debugger/getCurrentCircuitJson"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import bugReport from "../../fixtures/bug-reports/bugreport94-56fa2e/bugreport94-56fa2e.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport94-56fa2e.json", () => {
  const solver = new AutoroutingPipelineSolver(structuredClone(srj))
  solver.solve()

  const circuitJson = getCurrentCircuitJson(solver)
  expect(circuitJson).not.toBeNull()
  const { errors } = getDrcErrors(circuitJson!)
  expect(errors.length).toBeLessThanOrEqual(1)
  const viaCount = solver
    .getOutputSimplifiedPcbTraces()
    .flatMap((trace) => trace.route)
    .filter((point) => point.route_type === "via").length
  // Regional rerouting may add vias but must not lose retained transitions.
  expect(viaCount).toBeGreaterThanOrEqual(233)

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
    {
      // Linux may retain a different safe-layer candidate.
      tolerance: 0.3,
    },
  )
})
