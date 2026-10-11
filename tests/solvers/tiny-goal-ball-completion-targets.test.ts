import { expect, test } from "bun:test"
import { TinyGoalBallSelectiveReripHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyGoalBallSelectiveReripHyperGraphSolver"
import { TinyIndexedSelectiveReripHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyIndexedSelectiveReripHyperGraphSolver"
import type { Candidate, TinyHyperGraphSolver, TinyHyperGraphSolverOptions } from "tiny-hypergraph/lib/core"

class Harness extends TinyGoalBallSelectiveReripHyperGraphSolver {
  readonly acceptedCandidates: Array<{ portId: number; g: number }> = []
  completion(options: TinyHyperGraphSolverOptions, attempt: number): TinyHyperGraphSolver {
    return this.createGreedyFinalRouteSolver(options, attempt)
  }
  temporaryTarget(): void {
    this.partialRipRoutePlans.set(0, { routeId: 0, activeStartPortId: 1,
      activeEndPortId: 2, forcedStartRegionId: 1, forcedEndRegionId: 1,
      rippedSegmentCount: 1, retainedSegmentCount: 2 })
  }
  completionBounds(): void {
    // The real congestion-aware child opts into these bounds. Keep the parent
    // native until this harness explicitly models that child behavior.
    this.useGoalBallBounds = true
    this.goalBallHeuristic.validateSolver(this)
  }
  override onPathFound(candidate: Candidate): void {
    this.acceptedCandidates.push({ portId: candidate.portId, g: candidate.g })
    super.onPathFound(candidate)
  }
}

test("goal balls score the final goal arc and share prepared bounds with temporary targets and completion", (): void => {
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
  const options = { MAX_ITERATIONS: 1000, TRACE_DENSITY_COST_FACTOR: 0 }
  const routed = new Harness(topology, problem, options)
  routed.solve()
  expect(routed.solved).toBe(true)
  expect(routed.failed).toBe(false)
  const scoredTerminal = routed.acceptedCandidates.find((candidate) => candidate.portId === 3)
  expect(scoredTerminal).toBeDefined()
  expect(scoredTerminal!.g).toBeCloseTo(58.15, 10)
  routed.goalBallHeuristic.prepareSync()
  expect(routed.goalBallHeuristic.getBounds(10, 3)[0]).toBeCloseTo(scoredTerminal!.g, 10)
  const parent = new Harness(topology, problem, options)
  parent.goalBallHeuristic.prepareSync()
  parent.state.currentRouteId = 0
  parent.state.currentRouteNetId = 10
  const indexed = new TinyIndexedSelectiveReripHyperGraphSolver(topology, problem, options)
  indexed.state.currentRouteId = 0
  indexed.state.currentRouteNetId = 10
  expect(parent.computeH(1)).toBe(indexed.computeH(1))
  parent.completionBounds()
  expect(parent.computeH(1)).toBeGreaterThan(50)
  parent.temporaryTarget()
  expect(() => parent.goalBallHeuristic.getBounds(10, 2)).toThrow("before target preparation")
  expect(parent.prepareNextGoal()).toBeUndefined()
  expect(parent.computeH(1)).toBeCloseTo(7.05, 10)
  expect(parent.goalBallHeuristic.stats.goalBallGroupCount).toBe(2)
  parent.state.currentRouteId = undefined
  parent.state.currentRouteNetId = undefined
  const completion = parent.completion({ MAX_ITERATIONS: 12, PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: false, ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false }, -1)
  expect(completion).toBeInstanceOf(TinyGoalBallSelectiveReripHyperGraphSolver)
  expect((completion as TinyGoalBallSelectiveReripHyperGraphSolver).goalBallHeuristic).toBe(parent.goalBallHeuristic)
  expect(completion.MAX_ITERATIONS).toBe(2000)
  completion.solve()
  expect(completion.solved).toBe(true)
  expect(completion.failed).toBe(false)
  const greedy = parent.completion({ MAX_ITERATIONS: 12 }, 0)
  expect(greedy).not.toBeInstanceOf(TinyGoalBallSelectiveReripHyperGraphSolver)
  expect(greedy.computeG({ portId: 0, nextRegionId: 0, g: 2, f: 2, h: 0 }, 1)).toBe(2)
})
