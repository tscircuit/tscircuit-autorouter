import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { getCurrentCircuitJson } from "lib/testing/autorouting-pipeline-debugger/getCurrentCircuitJson"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import bugReport from "../../fixtures/bug-reports/bugreport94-56fa2e/bugreport94-56fa2e.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport94-56fa2e.json with Pipeline 9", (): void => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
  )
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const circuitJson = getCurrentCircuitJson(solver)
  expect(circuitJson).not.toBeNull()
  const { errors } = getDrcErrors(circuitJson!)
  expect(errors).toEqual([])

  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(snapshotPath)
})
