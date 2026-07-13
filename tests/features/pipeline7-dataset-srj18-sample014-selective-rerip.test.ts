import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

type SolveGraphSolverDebug = {
  stats?: Record<string, unknown>
}

type TinyPipelineSolverDebug = {
  getSolver: <T>(solverName: string) => T | undefined
}

test("pipeline7 routes srj18 sample014 without a selective rerip loop", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 14, 1)
  const solver = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
    effort: 1,
    cacheProvider: null,
  })

  solver.solveUntilPhase("portPointPathingSolver")
  while (
    solver.getCurrentPhase() === "portPointPathingSolver" &&
    !solver.failed &&
    !solver.solved
  ) {
    solver.step()
  }

  expect(solver.failed).toBe(false)
  expect(solver.portPointPathingSolver?.failed).toBe(false)
  expect(solver.portPointPathingSolver?.solved).toBe(true)
  const tinyPipelineSolver = (
    solver.portPointPathingSolver as unknown as {
      tinyPipelineSolver: TinyPipelineSolverDebug
    }
  ).tinyPipelineSolver
  const solveGraphSolver =
    tinyPipelineSolver.getSolver<SolveGraphSolverDebug>("solveGraph")
  expect(
    solveGraphSolver?.stats?.acceptedGreedyFinalRouteOnTimeout,
  ).toBeUndefined()
  expect(solveGraphSolver?.stats?.greedyConflictRepairApplied).toBe(true)
})
