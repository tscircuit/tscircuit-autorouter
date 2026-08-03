import { expect, test } from "bun:test"
import e2e3Fixture from "../fixtures/legacy/assets/e2e3.json"
import { AutoroutingPipelineSolver } from "../lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"

test("Pipeline7 bypasses signal-only traces without changing their DRC result", () => {
  const inputSrj = e2e3Fixture as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver(inputSrj)
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.powerTraceExpansionSolver?.stats.selectedTraceCount).toBe(0)
  const prePower = solver.getPrePowerTraceOutputSimplifiedPcbTraces()
  const postPower = solver.getOutputSimplifiedPcbTraces()
  expect(postPower).toEqual(prePower)

  const getErrors = (traces: SimplifiedPcbTraces) =>
    evaluateRelaxedDrc({
      inputSrj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: traces,
    }).errors
  expect(getErrors(postPower)).toEqual(getErrors(prePower))
})
