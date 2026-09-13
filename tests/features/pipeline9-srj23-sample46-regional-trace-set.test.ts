import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 clears SRJ23 sample 46 with movable preloaded traces", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 46)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors).toEqual([])
  // DRC-aware stitching can let exact repair finish before regional repair.
  // Require movable preloads and clean output, not a particular repair phase.
  expect(
    solver.pipeline9JointDrcRepairSolver?.stats.movablePreloadedTraceCount,
  ).toBeGreaterThan(0)
  expect(
    solver.pipeline9JointDrcRepairSolver?.stats.regionalB01RepairRemainingDrcIssueCount,
  ).toBe(0)
})
