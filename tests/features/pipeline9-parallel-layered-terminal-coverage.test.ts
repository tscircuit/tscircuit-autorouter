import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_Parallel } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/AutoroutingPipelineSolver9_Parallel"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import { evaluateConnectionCoverage } from "../../scripts/parallel-benchmark/parallelBenchmarkConnectionCoverage"

test("alternate Pipeline9 connects co-located opposite-layer SRJ18 sample011 pads", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 11)
  const pipeline = new AutoroutingPipelineSolver9_Parallel(scenario, {
    effort: 1, cacheProvider: null, workerCount: 4, highDensityPolicy: "first-valid",
    enableParallelPathSimplification: true,
  })
  try {
    await pipeline.solveAsync()
    expect(pipeline.solved).toBe(true)
    expect(pipeline.failed).toBe(false)
    if (!pipeline.srjWithPointPairs) throw new Error("Solved Pipeline9 has no point-pair requirements")
    const { errors, circuitJson } = evaluateRelaxedDrc({
      inputSrj: scenario, srjWithPointPairs: pipeline.srjWithPointPairs,
      routedTraces: pipeline.getOutputSimplifiedPcbTraces(),
    })
    const coverage = evaluateConnectionCoverage(scenario, circuitJson).summary
    expect(coverage.requiredNetCount).toBeGreaterThan(0)
    expect(coverage.uncoveredNetCount).toBe(0)
    expect(coverage.missingPortCount).toBe(0)
    expect(coverage.errorCount).toBe(0)
    expect(errors).toHaveLength(0)
    expect(pipeline.workerPool.stats.maxActiveWorkers).toBeLessThanOrEqual(4)
  } finally {
    pipeline.dispose()
  }
}, 120_000)
