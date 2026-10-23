import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { SelectiveReripTinyHyperGraphSolverWithCandidatePool } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithCandidatePool"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("native timeout acceptance allocates once before output without another route search", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 1)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(scenario)
  pipeline.solveUntilPhase("portPointPathingSolver")
  pipeline.step()
  const pathing = pipeline.portPointPathingSolver! as unknown as {
    tinyPipelineSolver: {
      getInitialVisualizationSolver(): SelectiveReripTinyHyperGraphSolverWithCandidatePool
    }
  }
  const native = pathing.tinyPipelineSolver.getInitialVisualizationSolver()
  expect(native).toBeInstanceOf(SelectiveReripTinyHyperGraphSolverWithCandidatePool)
  while (native.stats.jointCandidateCompleteRounds < 2 && !native.solved && !native.failed) {
    native.step()
  }
  expect(native.solved).toBe(false)
  expect(native.failed).toBe(false)
  expect(native.stats.jointCandidateDistinctCaptures).toBe(2)
  native.MAX_ITERATIONS = native.iterations + 1
  native.step()
  expect(native.solved).toBe(true)
  expect(native.failed).toBe(false)
  expect(native.stats.acceptedBestSolutionOnTimeout).toBe(true)
  const iterationsBeforeExport = native.iterations
  const output = native.getOutput()
  expect(native.stats.jointCandidateEligibleBoards).toBe(1)
  expect(native.stats.jointCandidateTrials).toBeGreaterThan(0)
  expect(native.stats.jointCandidateFinalizationCount).toBe(1)
  const stats = { ...native.stats }
  expect(native.getOutput()).toEqual(output)
  expect(native.stats).toEqual(stats)
  expect(native.iterations).toBe(iterationsBeforeExport)
})
