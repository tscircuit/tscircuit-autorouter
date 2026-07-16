import { expect, test } from "bun:test"
import {
  AutoroutingPipelineSolver7_MultiGraph,
  getPipeline7PostProcessingEffortConfig,
} from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

const getViaCount = (routes: HighDensityRoute[]): number => {
  let viaCount = 0
  for (const route of routes) {
    viaCount += route.vias.length
  }
  return viaCount
}

test("pipeline7 max-effort post-processing converges on srj18 sample005", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 5, 0.1)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    effort: 0.1,
    cacheProvider: null,
  })

  // Keep route generation small so this regression isolates the post-process
  // stages. Their constructors read the increased effort after this phase.
  solver.solveUntilPhase("traceSimplificationSolver")
  expect(solver.failed).toBe(false)
  const stitchedViaCount = getViaCount(
    solver.highDensityStitchSolver!.mergedHdRoutes,
  )

  solver.effort = 100
  solver.postProcessingEffortConfig =
    getPipeline7PostProcessingEffortConfig(100)
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(getViaCount(solver._getOutputHdRoutes())).toBeLessThan(
    stitchedViaCount,
  )
  expect(solver.traceSimplificationSolver?.simplificationPipelineLoops).toBe(4)
  expect(
    solver.traceSimplificationSolver?.stats
      .simplificationStoppedAfterNoImprovement,
  ).toBe(true)
  expect(solver.globalDrcForceImproveSolver?.iterations).toBeLessThan(1600)
  expect(
    solver.globalDrcForceImproveSolver?.stats.finalDrcIssueCount,
  ).toBeLessThan(solver.globalDrcForceImproveSolver?.stats.initialDrcIssueCount)
  expect(solver.exactGeometryDrcForceImproveSolver?.iterations).toBeLessThan(
    3200,
  )
})
