import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_Parallel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/AutoroutingPipelineSolver9_Parallel"
import { ParallelPortPointPathingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortPointPathingSolver"
import type { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("goal-ball parent routing exactly matches landmarks when cost-aware completion is unnecessary", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 16)
  const pipeline = new AutoroutingPipelineSolver9_Parallel(scenario, { effort: 1, cacheProvider: null,
    workerCount: 4, pathingStrategy: "landmark" })
  try {
    await pipeline.solveUntilPhaseAsync("portPointPathingSolver")
    const stage = pipeline.pipelineDef.find((entry) => entry.solverName === "portPointPathingSolver")
    if (!stage) throw new Error("Missing pathing fixture stage")
    const [params] = stage.getConstructorParams(pipeline)
    const input = params as ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0]
    const landmark = new ParallelPortPointPathingSolver(input, { strategy: "landmark" })
    const goalBalls = new ParallelPortPointPathingSolver(input, { strategy: "goal-balls" })
    landmark.solve()
    goalBalls.solve()
    expect(landmark.solved).toBe(true)
    expect(goalBalls.solved).toBe(true)
    expect(goalBalls.failed).toBe(false)
    expect(goalBalls.getOutput()).toEqual(landmark.getOutput())
    const { timeMs: _landmarkTimeMs, ...landmarkMetrics } = landmark.getSolveGraphBenchmarkMetrics()!
    const { timeMs: _goalTimeMs, ...goalMetrics } = goalBalls.getSolveGraphBenchmarkMetrics()!
    expect(goalMetrics).toEqual(landmarkMetrics)
    expect(goalBalls.stats.goalBallGroupCount).toBe(0)
    expect(goalBalls.stats.goalBallTableBytes).toBe(0)
    expect(goalBalls.stats.goalBallLandmarkCount).toBe(4)
  } finally { pipeline.dispose() }
})
