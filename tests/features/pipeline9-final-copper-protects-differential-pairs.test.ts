import { expect, test } from "bun:test"
import { Pipeline9FinalCopperRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9FinalCopperRepairSolver"
import { createFinalCopperRepairFixture } from "tests/fixtures/pipeline9-final-copper-fixture"

test("final copper repair preserves length-matched differential pair geometry", (): void => {
  const { srj, trace } = createFinalCopperRepairFixture()
  srj.differentialPairs = [
    {
      connectionNames: ["signal", "signal_n"],
      lengthTolerance: 0.05,
      maxUncoupledLength: 0.5,
    },
  ]
  const solver = new Pipeline9FinalCopperRepairSolver({
    originalSrj: srj,
    srjWithPointPairs: srj,
    traces: [trace],
    effort: 1,
  })
  solver.solve()
  expect(solver.failed).toBeFalse()
  expect(solver.getOutput()).toEqual([trace])
  expect(solver.stats.finalCopperInitialDrcIssueCount).toBeGreaterThan(0)
  expect(solver.stats.finalCopperAcceptedCount).toBe(0)
})
