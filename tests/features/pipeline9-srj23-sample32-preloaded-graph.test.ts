import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test(
  "Pipeline9 gives dense srj23 inputs a baseline-relative refinement budget",
  async () => {
    const { scenario } = await loadScenarioBySampleNumber("srj23", 32)
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      scenario,
      {
        cacheProvider: null,
        effort: 1,
      },
    )

    while (!solver.failed && !solver.portPointPathingSolver?.solved) {
      solver.step()
    }

    expect(solver.failed).toBe(false)
    expect(solver.portPointPathingSolver?.solved).toBe(true)
    const stats = solver.preloadedTraceGraphSolver?.stats
    if (!stats) {
      throw new Error("Expected Pipeline9 preloaded graph stats")
    }
    expect(stats.minimumRefinementWorstCaseAllowance).toBe(2_050)
    expect(stats.effectiveMaxOutputNodeCount).toBe(
      Math.max(
        3_000,
        stats.minimumLayerSplitNodeCount +
          stats.minimumRefinementWorstCaseAllowance,
      ),
    )
    expect(stats.outputNodeCount).toBeLessThan(
      stats.effectiveMaxOutputNodeCount,
    )
  },
  { timeout: 15_000 },
)
