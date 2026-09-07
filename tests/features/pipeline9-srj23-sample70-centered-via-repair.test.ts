import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 repairs the centered-via conflict in SRJ23 sample 70", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 70)
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
  expect(errors).toHaveLength(0)

  // High-density repair can remove the conflict before regional B01 runs.
  // Require an actual issue-count reduction for that earlier repair path.
  const highDensityStats = solver.highDensityDrcRepairSolver!.stats
  const regionalAcceptedCount = Number(
    solver.pipeline9JointDrcRepairSolver!.stats.regionalB01RepairAcceptedCount,
  )
  expect(
    regionalAcceptedCount > 0 ||
      Number(highDensityStats.initialDrcIssueCount) >
        Number(highDensityStats.finalDrcIssueCount),
  ).toBeTrue()
})
