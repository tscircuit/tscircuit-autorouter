import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import scenario from "../../fixtures/legacy/assets/e2e3.json"

test("an explicit pathing budget grows native search without changing cleanup effort", (): void => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario) as SimpleRouteJson,
    { effort: 1, pathingEffort: 8, cacheProvider: null } as any,
  )
  while (solver.getCurrentPhase() !== "portPointPathingSolver" && !solver.failed && !solver.solved) solver.step()
  expect(solver.failed).toBe(false)
  const stage = solver.pipelineDef.find(stage => stage.solverName === "portPointPathingSolver")!
  const params = stage.getConstructorParams(solver) as Array<{ effort: number }>
  expect(params[0].effort).toBe(8)
  expect(solver.effort).toBe(1)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.getOutputSimplifiedPcbTraces().length).toBeGreaterThan(0)
})
