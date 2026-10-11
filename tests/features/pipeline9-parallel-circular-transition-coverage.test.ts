import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_Parallel } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/AutoroutingPipelineSolver9_Parallel"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import { pointInsideObstacleCopper } from "../../lib/utils/pointInsideObstacleCopper"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import { evaluateConnectionCoverage } from "../../scripts/parallel-benchmark/parallelBenchmarkConnectionCoverage"

test("alternate Pipeline9 retains physical vias outside circular copper and connects all SRJ18 sample009 terminals", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 9, 1)
  const pipeline = new AutoroutingPipelineSolver9_Parallel(scenario, {
    effort: 1, cacheProvider: null, workerCount: 4, highDensityPolicy: "first-valid",
    pathingStrategy: "indexed", enableParallelPathSimplification: true,
  })
  try {
    await pipeline.solveAsync()
    expect(pipeline.solved).toBe(true)
    expect(pipeline.failed).toBe(false)
    if (!pipeline.srjWithPointPairs) throw new Error("Solved Pipeline9 has no point-pair requirements")
    const traces = pipeline.getOutputSimplifiedPcbTraces()
    const { errors, circuitJson } = evaluateRelaxedDrc({
      inputSrj: scenario, srjWithPointPairs: pipeline.srjWithPointPairs,
      routedTraces: traces,
    })
    const coverage = evaluateConnectionCoverage(scenario, circuitJson).summary
    expect(coverage.requiredNetCount).toBe(72)
    expect(coverage.requiredPairCount).toBe(256)
    expect(coverage.coveredNetCount).toBe(72)
    expect(coverage.uncoveredNetCount).toBe(0)
    expect(coverage.missingPortCount).toBe(0)
    expect(coverage.errorCount).toBe(0)
    expect(errors).toHaveLength(0)
    const invalidThroughMarkers = traces.flatMap((trace) => trace.route.flatMap((point) => {
      if (point.route_type !== "through_obstacle") return []
      const id = point.circuitJsonMetadata?.pcb_plated_hole_id
      const obstacle = scenario.obstacles.find((candidate) => id && candidate.circuitJsonMetadata?.pcb_plated_hole_id === id)
      if (!obstacle) return []
      return !pointInsideObstacleCopper(point.start, obstacle) || !pointInsideObstacleCopper(point.end, obstacle)
        ? [{ traceId: trace.pcb_trace_id, point }] : []
    }))
    expect(invalidThroughMarkers).toHaveLength(0)
    expect(pipeline.workerPool.stats.maxActiveWorkers).toBeLessThanOrEqual(4)
  } finally {
    pipeline.dispose()
  }
})
