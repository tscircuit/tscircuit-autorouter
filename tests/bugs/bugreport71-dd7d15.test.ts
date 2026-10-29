import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph as AutoroutingPipelineSolver } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import bugReport from "../../fixtures/bug-reports/bugreport71-dd7d15/bugreport71-dd7d15.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport71-dd7d15.json", () => {
  const solver = new AutoroutingPipelineSolver(srj)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    }).errors,
  ).toHaveLength(0)
  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(snapshotPath)
})
