import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_Parallel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/AutoroutingPipelineSolver9_Parallel"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { runTraceLinting } from "lib/testing/runTraceLinting"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import { evaluateConnectionCoverage } from "../../scripts/parallel-benchmark/parallelBenchmarkConnectionCoverage"

test("four-worker negotiated pathing retains full SRJ18 sample016 coverage and downstream quality", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 16)
  const pipeline = new AutoroutingPipelineSolver9_Parallel(scenario, {
    effort: 1, cacheProvider: null, workerCount: 4, pathingStrategy: "negotiated",
  })
  try {
    await pipeline.solveAsync()
    expect(pipeline.solved).toBe(true)
    expect(pipeline.failed).toBe(false)
    expect(pipeline.workerPool.stats.maxActiveWorkers).toBe(4)
    const traces = pipeline.getOutputSimplifiedPcbTraces()
    const output = pipeline.getOutputSimpleRouteJson()
    const { errors, circuitJson } = evaluateRelaxedDrc({ inputSrj: scenario,
      srjWithPointPairs: pipeline.srjWithPointPairs ?? scenario, routedTraces: traces })
    const coverage = evaluateConnectionCoverage(scenario, circuitJson).summary
    expect(coverage.requiredNetCount).toBe(59)
    expect(coverage.requiredPairCount).toBe(273)
    expect(coverage.coveredNetCount).toBe(59)
    expect(coverage.uncoveredNetCount).toBe(0)
    expect(coverage.missingPortCount).toBe(0)
    expect(coverage.errorCount).toBe(0)
    expect(errors).toHaveLength(0)
    const lintCounts: Record<string, number> = {}
    for (const issue of runTraceLinting(output).getOutput()) lintCounts[issue.type] = (lintCounts[issue.type] ?? 0) + 1
    expect(Object.keys(lintCounts)).toEqual(["odd_angle"])
    expect(lintCounts.odd_angle).toBeLessThanOrEqual(389)
  } finally { pipeline.dispose() }
})
