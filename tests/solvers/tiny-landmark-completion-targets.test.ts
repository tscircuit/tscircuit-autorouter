import { expect, test } from "bun:test"
import { TinyLandmarkSelectiveReripHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyLandmarkSelectiveReripHyperGraphSolver"
import type { TinyHyperGraphSolver, TinyHyperGraphSolverOptions } from "tiny-hypergraph/lib/core"

class Harness extends TinyLandmarkSelectiveReripHyperGraphSolver {
  completion(options: TinyHyperGraphSolverOptions, attempt: number): TinyHyperGraphSolver {
    return this.createGreedyFinalRouteSolver(options, attempt)
  }
  temporaryTarget(): void {
    this.partialRipRoutePlans.set(0, { routeId: 0, activeStartPortId: 1,
      activeEndPortId: 2, forcedStartRegionId: 1, forcedEndRegionId: 1,
      rippedSegmentCount: 1, retainedSegmentCount: 2 })
  }
}

test("landmarks reuse ready bounds in cost-aware completion and use temporary partial-rip targets", (): void => {
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
  const parent = new Harness(topology, problem, { MAX_ITERATIONS: 1000 })
  parent.landmarkHeuristic.prepareSync()
  parent.state.currentRouteId = 0
  parent.state.currentRouteNetId = 10
  expect(parent.computeH(1)).toBeGreaterThan(50)
  parent.temporaryTarget()
  expect(parent.computeH(1)).toBeCloseTo(7.05, 10)
  parent.state.currentRouteId = undefined
  parent.state.currentRouteNetId = undefined
  const completion = parent.completion({ MAX_ITERATIONS: 12, PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: false, ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false }, -1)
  expect(completion).toBeInstanceOf(TinyLandmarkSelectiveReripHyperGraphSolver)
  const landmarkCompletion = completion as TinyLandmarkSelectiveReripHyperGraphSolver
  expect(landmarkCompletion.landmarkHeuristic).toBe(parent.landmarkHeuristic)
  expect(landmarkCompletion.landmarkHeuristic.ready).toBe(true)
  expect(completion.MAX_ITERATIONS).toBe(2000)
  completion.solve()
  expect(completion.solved).toBe(true)
  expect(completion.failed).toBe(false)
  expect(completion.state.unroutedRoutes).toHaveLength(0)
  const greedy = parent.completion({ MAX_ITERATIONS: 12 }, 0)
  expect(greedy).not.toBeInstanceOf(TinyLandmarkSelectiveReripHyperGraphSolver)
  expect(greedy.computeG({ portId: 0, nextRegionId: 0, g: 2, f: 2, h: 0 }, 1)).toBe(2)
})
