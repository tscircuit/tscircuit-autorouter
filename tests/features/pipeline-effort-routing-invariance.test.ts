import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import scenario from "../../fixtures/legacy/assets/e2e3.json"

test("higher effort preserves initial routing and extends cleanup budgets", (): void => {
  const routes: unknown[] = []
  for (const effort of [1, 1.5, 2]) {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(scenario) as SimpleRouteJson,
      { effort, cacheProvider: null },
    )
    while (solver.getCurrentPhase() !== "traceSimplificationSolver" && !solver.failed && !solver.solved) solver.step()
    expect(solver.failed).toBe(false)
    expect(solver.getCurrentPhase()).toBe("traceSimplificationSolver")
    routes.push(structuredClone(solver.highDensityStitchSolver!.mergedHdRoutes))
    solver.step()
    expect(solver.traceSimplificationSolver!.MAX_ITERATIONS).toBe(100e6 * effort)
    expect(solver.traceSimplificationSolver!.MAX_SIMPLIFICATION_PIPELINE_LOOPS).toBe(2 * effort)
  }
  expect(routes[1]).toEqual(routes[0])
  expect(routes[2]).toEqual(routes[0])
})
