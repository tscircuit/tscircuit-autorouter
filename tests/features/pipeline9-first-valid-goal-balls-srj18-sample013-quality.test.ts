import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_Parallel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/AutoroutingPipelineSolver9_Parallel"
import { runTraceLinting } from "lib/testing/runTraceLinting"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import { evaluateConnectionCoverage } from "../../scripts/parallel-benchmark/parallelBenchmarkConnectionCoverage"
import { evaluateParallelBenchmarkDrc } from "../../scripts/parallel-benchmark/parallelBenchmarkDrc"

test("first-valid goal-ball routing retains every sample013 terminal after leading via path sampling", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 13)
  const pipeline = new AutoroutingPipelineSolver9_Parallel(scenario, {
    effort: 1, cacheProvider: null, workerCount: 4, enableParallelPathSimplification: true,
    highDensityPolicy: "first-valid", pathingStrategy: "goal-balls",
  })
  try {
    await pipeline.solveAsync()
    expect(pipeline.solved).toBe(true)
    expect(pipeline.failed).toBe(false)
    expect(pipeline.workerPool.stats.maxActiveWorkers).toBeLessThanOrEqual(4)
    const traces = pipeline.getOutputSimplifiedPcbTraces()
    const { errors, circuitJson } = evaluateParallelBenchmarkDrc({ inputSrj: scenario,
      srjWithPointPairs: pipeline.srjWithPointPairs ?? scenario, routedTraces: traces })
    const coverage = evaluateConnectionCoverage(scenario, circuitJson).summary
    expect(coverage.requiredNetCount).toBe(52)
    expect(coverage.requiredPairCount).toBe(238)
    expect(coverage.coveredNetCount).toBe(52)
    expect(coverage.uncoveredNetCount).toBe(0)
    expect(coverage.missingPortCount).toBe(0)
    expect(coverage.errorCount).toBe(0)
    expect(traces).toHaveLength(238)
    expect(errors).toHaveLength(0)
    const lintCounts: Record<string, number> = {}
    for (const issue of runTraceLinting(pipeline.getOutputSimpleRouteJson()).getOutput()) {
      lintCounts[issue.type] = (lintCounts[issue.type] ?? 0) + 1
    }
    expect(Object.keys(lintCounts)).toEqual(["odd_angle"])
    expect(lintCounts.odd_angle).toBeLessThanOrEqual(592)
  } finally {
    pipeline.dispose()
  }
})
