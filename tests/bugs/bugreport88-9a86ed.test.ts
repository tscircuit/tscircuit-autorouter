import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport88-9a86ed/bugreport88-9a86ed.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { createPcbBoardElement } from "lib/testing/utils/convertToCircuitJson"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport88-9a86ed.json", () => {
  const solver = new AutoroutingPipelineSolver(structuredClone(srj))
  solver.solve()
  const { circuitJson } = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })

  const { errors } = getDrcErrors(
    [createPcbBoardElement(srj), ...circuitJson],
    RELAXED_DRC_OPTIONS,
  )

  expect(errors).toHaveLength(0)
  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(snapshotPath)
})
