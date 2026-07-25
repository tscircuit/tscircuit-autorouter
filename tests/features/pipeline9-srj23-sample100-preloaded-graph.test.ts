import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test(
  "Pipeline9 completes srj23 sample 100 with the bounded preloaded graph",
  async () => {
    const { scenario } = await loadScenarioBySampleNumber("srj23", 100)
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      scenario,
      {
        cacheProvider: null,
        effort: 1,
      },
    )

    solver.solve()

    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    expect(solver.preloadedTraceGraphSolver?.stats).toMatchObject({
      refinementBudgetExhausted: true,
      effectiveMaxOutputNodeCount: 3_000,
    })
    expect(
      solver.preloadedTraceGraphSolver?.stats.outputNodeCount,
    ).toBeLessThan(3_000)
    expect(
      evaluateRelaxedDrc({
        inputSrj: scenario,
        srjWithPointPairs: solver.srjWithPointPairs!,
        traces: solver.getOutputSimplifiedPcbTraces(),
      }).errors,
    ).toEqual([])
  },
  { timeout: 30_000 },
)
