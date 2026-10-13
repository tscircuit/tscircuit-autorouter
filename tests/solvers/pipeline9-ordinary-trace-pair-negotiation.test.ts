import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("negotiates ordinary trace-pair errors without spending a B01 search allowance", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 4)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(scenario, {
    effort: 1,
    cacheProvider: null,
  })
  pipeline.solve()
  expect(pipeline.solved).toBe(true)
  expect(pipeline.failed).toBe(false)
  const stats = pipeline.pipeline9JointDrcRepairSolver!.stats
  expect(stats.regionalB01RepairPreloadEligibleDrcIssueCount).toBe(0)
  expect(stats.regionalB01RepairCandidateSearchCount).toBe(0)
  expect(stats.boundedRegionalRepairRepaired).toBe(true)
  expect(stats.boundedRegionalRepairPublishedDrcIssueCount).toBe(0)
  const output = pipeline.getOutputSimpleRouteJson()
  expect(
    evaluateRelaxedDrc({
      inputSrj: output,
      srjWithPointPairs: pipeline.srjWithPointPairs!,
      routedTraces: [],
      includeBoardClearance: true,
    }).errors,
  ).toEqual([])
})
