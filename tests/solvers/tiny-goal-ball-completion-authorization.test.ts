import { expect, test } from "bun:test"
import { TinyGoalBallSelectiveReripHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyGoalBallSelectiveReripHyperGraphSolver"
import type { TinyHyperGraphSolver, TinyHyperGraphSolverOptions } from "tiny-hypergraph/lib/core"

class CompletionAuthorizationHarness extends TinyGoalBallSelectiveReripHyperGraphSolver {
  readonly completionAttempts: number[] = []

  protected override createGreedyFinalRouteSolver(
    options: TinyHyperGraphSolverOptions,
    attempt: number,
  ): TinyHyperGraphSolver {
    this.completionAttempts.push(attempt)
    const solver = super.createGreedyFinalRouteSolver(options, attempt)
    expect(solver.MAX_ITERATIONS).toBe(50_000)
    return solver
  }

  reopenBestNativeSnapshotAtCap(): void {
    if (!this.solved || this.failed) {
      throw new Error("Expected completed native routing before probing snapshot acceptance")
    }
    this.replaceBestSolvedState(this.summarizeSolvedState(this))
    this.solved = false
    this.failed = false
    this.error = null
    this.iterations = this.MAX_ITERATIONS - 1
  }
}

function createSolver(options: TinyHyperGraphSolverOptions = {}): CompletionAuthorizationHarness {
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
  return new CompletionAuthorizationHarness(topology, problem, {
    MAX_ITERATIONS: 1000, TRACE_DENSITY_COST_FACTOR: 0,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true, GREEDY_FINAL_ROUTE_ITERS: 4,
    PARTIAL_RIP_ENABLED: false, OUTSIDE_IN_ROUTING: false, ...options,
  })
}

test("goal-ball preparation obeys native completion authorization and skips snapshot and ordinary-greedy acceptance", (): void => {
  for (const options of [
    { ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false },
    { GREEDY_FINAL_ROUTE_ITERS: 0 },
    { GREEDY_FINAL_ROUTE_ITERS: 0.75 },
  ]) {
    const solver = createSolver(options)
    solver.iterations = solver.MAX_ITERATIONS - 1
    expect(solver.needsCompletionGoalPreparation).toBe(false)
    expect(solver.hasGoalBallHeuristic).toBe(false)
    solver.tryFinalAcceptance()
    expect(solver.completionAttempts).toEqual([])
    expect(solver.hasGoalBallHeuristic).toBe(false)
    expect(solver.solved).toBe(false)
  }

  const empty = createSolver()
  empty.iterations = empty.MAX_ITERATIONS - 1
  empty.state.unroutedRoutes = []
  empty.state.currentRouteId = undefined
  expect(empty.needsCompletionGoalPreparation).toBe(false)
  expect(empty.hasGoalBallHeuristic).toBe(false)
  empty.tryFinalAcceptance()
  expect(empty.completionAttempts).toEqual([])
  expect(empty.hasGoalBallHeuristic).toBe(false)

  const greedyOnly = createSolver()
  greedyOnly.iterations = greedyOnly.MAX_ITERATIONS - 1
  greedyOnly.state.ripCount = 8
  expect(greedyOnly.needsCompletionGoalPreparation).toBe(false)
  expect(greedyOnly.hasGoalBallHeuristic).toBe(false)
  greedyOnly.tryFinalAcceptance()
  expect(greedyOnly.solved).toBe(true)
  expect(greedyOnly.failed).toBe(false)
  expect(greedyOnly.completionAttempts).toEqual([0])
  expect(greedyOnly.stats.finalRoutingStrategy).toBe("greedy")
  expect(greedyOnly.stats.greedyFinalRouteMaxIterations).toBe(50_000)
  expect(greedyOnly.hasGoalBallHeuristic).toBe(false)

  const bestSnapshot = createSolver()
  bestSnapshot.solve()
  expect(bestSnapshot.solved).toBe(true)
  expect(bestSnapshot.hasGoalBallHeuristic).toBe(false)
  const originalSegments = structuredClone(bestSnapshot.state.regionSegments)
  bestSnapshot.reopenBestNativeSnapshotAtCap()
  expect(bestSnapshot.needsCompletionGoalPreparation).toBe(false)
  expect(bestSnapshot.hasGoalBallHeuristic).toBe(false)
  bestSnapshot.tryFinalAcceptance()
  expect(bestSnapshot.solved).toBe(true)
  expect(bestSnapshot.failed).toBe(false)
  expect(bestSnapshot.stats.acceptedBestSolutionOnTimeout).toBe(true)
  expect(bestSnapshot.state.regionSegments).toEqual(originalSegments)
  expect(bestSnapshot.completionAttempts).toEqual([])
  expect(bestSnapshot.hasGoalBallHeuristic).toBe(false)
})
