import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { TinyGoalBallSelectiveReripHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyGoalBallSelectiveReripHyperGraphSolver"

test("goal-ball workers prepare before the original completion boundary without consuming route iterations", async (): Promise<void> => {
  const topology = {
    portCount: 4, regionCount: 3,
    incidentPortRegion: [[0], [0, 1], [1, 2], [2]], regionIncidentPorts: [[0, 1], [1, 2], [2, 3]],
    regionWidth: new Float64Array([1, 1, 1]), regionHeight: new Float64Array([1, 1, 1]),
    regionCenterX: new Float64Array([0.5, 1.5, 2.5]), regionCenterY: new Float64Array(3),
    portX: new Float64Array([0, 1, 2, 3]), portY: new Float64Array(4), portZ: new Int32Array(4),
    portAngleForRegion1: new Int32Array([18000, 0, 0, 0]), portAngleForRegion2: new Int32Array([0, 18000, 18000, 0]),
  }
  const problem = {
    routeCount: 1, routeStartPort: new Int32Array([0]), routeEndPort: new Int32Array([3]),
    routeNet: new Int32Array([10]), regionNetId: new Int32Array(3).fill(-1),
    portSectionMask: new Int8Array(4).fill(1), portPenalty: new Float64Array([0, 1, 7, 50]),
  }
  const solver = new TinyGoalBallSelectiveReripHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 2, TRACE_DENSITY_COST_FACTOR: 0, ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
    GREEDY_FINAL_ROUTE_ITERS: 4, PARTIAL_RIP_ENABLED: false, OUTSIDE_IN_ROUTING: false,
  })
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  try {
    expect(solver.hasGoalBallHeuristic).toBe(false)
    expect(solver.iterations).toBe(0)
    expect(solver.needsCompletionGoalPreparation).toBe(false)
    expect(solver.hasGoalBallHeuristic).toBe(false)
    solver.step()
    expect(solver.iterations).toBe(1)
    expect(solver.needsCompletionGoalPreparation).toBe(true)
    expect(solver.hasGoalBallHeuristic).toBe(true)
    const preparation = solver.goalBallHeuristic.prepare(pool)
    expect(solver.iterations).toBe(1)
    expect(solver.goalBallHeuristic.ready).toBe(false)
    await preparation
    expect(solver.iterations).toBe(1)
    expect(solver.goalBallHeuristic.ready).toBe(true)
    solver.step()
    expect(solver.iterations).toBe(2)
    expect(solver.MAX_ITERATIONS).toBe(2)
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.stats.finalRoutingStrategy).toBe("congestion-aware")
    expect(solver.state.unroutedRoutes).toHaveLength(0)
    expect(solver.goalBallHeuristic.stats.goalBallGroupCount).toBe(1)
    expect(pool.stats.maxActiveWorkers).toBeLessThanOrEqual(4)
  } finally { pool.dispose() }
})
