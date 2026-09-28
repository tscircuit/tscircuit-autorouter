import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import scenario from "../../fixtures/legacy/assets/e2e3.json"

test("routing cleanup completes passes proportional to effort", (): void => {
  for (const Solver of [
    AutoroutingPipelineSolver7_MultiGraph,
    AutoroutingPipelineSolver9_PreloadedTraceGraph,
  ]) {
    for (const [effort, passes] of [
      [0.1, 1],
      [1, 2],
      [1.5, 3],
      [2, 4],
    ]) {
      const input = structuredClone(scenario) as SimpleRouteJson
      const inputSnapshot = structuredClone(input)
      const solver = new Solver(input, { effort, cacheProvider: null })
      solver.solveUntilPhase("traceWidthSolver")
      expect(solver.failed).toBe(false)
      expect(solver.traceSimplificationSolver?.solved).toBe(true)
      expect(
        solver.traceSimplificationSolver?.simplificationPipelineLoops,
      ).toBe(passes)
      expect(
        solver.traceSimplificationSolver?.simplifiedHdRoutes.length,
      ).toBeGreaterThan(0)
      if (solver instanceof AutoroutingPipelineSolver9_PreloadedTraceGraph) {
        expect(solver.mutatedPreloadedTraceSimplificationSolver?.solved).toBe(
          true,
        )
        expect(
          solver.mutatedPreloadedTraceSimplificationSolver
            ?.simplificationPipelineLoops,
        ).toBe(passes)
      }
      expect(input).toEqual(inputSnapshot)
    }
  }
})
