import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_Parallel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/AutoroutingPipelineSolver9_Parallel"
import { ParallelPortPointPathingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortPointPathingSolver"
import type { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import type { TinyGoalBallSelectiveReripHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyGoalBallSelectiveReripHyperGraphSolver"

test("goal-ball parent keeps native indexed output and PF with no heuristic allocation or worker preparation", async (): Promise<void> => {
  for (const sample of [1, 16]) {
  const { scenario } = await loadScenarioBySampleNumber("srj18", sample)
  const pipeline = new AutoroutingPipelineSolver9_Parallel(scenario, { effort: 1, cacheProvider: null,
    workerCount: 4, pathingStrategy: "indexed" })
  try {
    await pipeline.solveUntilPhaseAsync("portPointPathingSolver")
    const stage = pipeline.pipelineDef.find((entry) => entry.solverName === "portPointPathingSolver")
    if (!stage) throw new Error("Missing pathing fixture stage")
    const [params] = stage.getConstructorParams(pipeline)
    const input = params as ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0]
    const indexed = new ParallelPortPointPathingSolver(input, { strategy: "indexed" })
    const goalBalls = new ParallelPortPointPathingSolver(input, { strategy: "goal-balls", workerPool: pipeline.workerPool })
    const originalWorkerStats = { ...pipeline.workerPool.stats }
    indexed.solve()
    await goalBalls.solveAsync()
    expect(indexed.solved).toBe(true)
    expect(goalBalls.solved).toBe(true)
    expect(goalBalls.failed).toBe(false)
    expect(goalBalls.getOutput()).toEqual(indexed.getOutput())
    const { timeMs: _indexedTimeMs, ...indexedMetrics } = indexed.getSolveGraphBenchmarkMetrics()!
    const { timeMs: _goalTimeMs, ...goalMetrics } = goalBalls.getSolveGraphBenchmarkMetrics()!
    expect(goalMetrics).toEqual(indexedMetrics)
    expect(goalBalls.iterations).toBe(indexed.iterations)
    expect(goalBalls.MAX_ITERATIONS).toBe(indexed.MAX_ITERATIONS)
    expect(goalBalls.stats.candidatePortfolioPrimarySummary).toEqual(indexed.stats.candidatePortfolioPrimarySummary)
    expect(goalBalls.stats.goalBallGraphEdgeCount).toBeUndefined()
    expect(goalBalls.stats.goalBallGroupCount).toBeUndefined()
    expect(goalBalls.stats.goalBallTableBytes).toBeUndefined()
    expect(goalBalls.stats.goalBallLandmarkCount).toBeUndefined()
    expect(pipeline.workerPool.stats).toEqual(originalWorkerStats)
    const tiny = (goalBalls as unknown as { tinyPipelineSolver: { getSolver: (name: string) => TinyGoalBallSelectiveReripHyperGraphSolver } })
      .tinyPipelineSolver.getSolver("solveGraph")
    expect(tiny.hasGoalBallHeuristic).toBe(false)
  } finally { pipeline.dispose() }
  }
})
