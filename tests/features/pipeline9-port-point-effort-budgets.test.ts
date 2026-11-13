import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import scenario from "../../fixtures/legacy/assets/e2e3.json"

test("Pipeline 9 passes effort to the global and regional port-point search limits", (): void => {
  const budgets = [0.5, 1, 2].map((effort) => {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(scenario) as SimpleRouteJson,
      { effort, cacheProvider: null },
    )
    solver.solveUntilPhase("portPointPathingSolver")
    const limits: Record<string, number> = {}
    while (
      solver.getCurrentPhase() === "portPointPathingSolver" &&
      !solver.failed
    ) {
      solver.step()
      const active = solver.portPointPathingSolver?.activeSubSolver
      if (active) limits[active.getSolverName()] = active.MAX_ITERATIONS
    }
    expect(solver.failed).toBe(false)
    return [
      limits.PreparedPortPointRoutingSolver,
      limits.TinyHyperGraphSectionSolver,
    ]
  })
  expect(budgets).toEqual([
    [1_000_000, 500_000],
    [2_000_000, 1_000_000],
    [4_000_000, 1_000_000],
  ])
})
