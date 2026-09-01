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
  expect(errors.length).toBeLessThanOrEqual(6)
  const targetOverlap = errors.find(
    (error) =>
      error.type === "pcb_trace_error" &&
      error.pcb_trace_error_id.includes("source_trace_108") &&
      error.pcb_trace_error_id.includes("source_trace_138"),
  )
  expect(targetOverlap).toBeUndefined()

  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(snapshotPath)
}, 300_000)
