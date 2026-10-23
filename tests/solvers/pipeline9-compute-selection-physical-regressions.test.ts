import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("accepted compute selections preserve physical endpoints on boards that exposed invalid prior winners", async () => {
  for (const sample of [5, 6, 11]) {
    const { scenario } = await loadScenarioBySampleNumber("srj18", sample)
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { effort: 1, cacheProvider: null })
    solver.solve()
    expect(solver.solved, `sample ${sample}: ${solver.error}`).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.highDensityRouteSolver!.stats.learnedComputeValidOutcomeCount).toBeGreaterThan(0)
    expect(evaluateRelaxedDrc({ inputSrj: scenario, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: solver.getOutputSimplifiedPcbTraces() }).errors).toHaveLength(0)
  }
})
