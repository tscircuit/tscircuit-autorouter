import { expect, test } from "bun:test"
import { ConflictAwareTinyHyperGraphSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/conflict-aware-tiny-hyper-graph-solver"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/index"

class ExposedConflictAwareSolver extends ConflictAwareTinyHyperGraphSolver {
  skipGreedyTimeoutFallback(): boolean {
    return this.tryGreedyFinalRouteAcceptance()
  }
}

test("conflict-aware routing rejects the unconstrained greedy timeout fallback", (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 1,
    regionIncidentPorts: [[0, 1]],
    incidentPortRegion: [[0], [0]],
    regionWidth: new Float64Array([1]),
    regionHeight: new Float64Array([1]),
    regionCenterX: new Float64Array([0]),
    regionCenterY: new Float64Array([0]),
    portAngleForRegion1: new Int32Array([0, 18000]),
    portX: new Float64Array([0, 1]),
    portY: new Float64Array([0, 0]),
    portZ: new Int32Array([0, 0]),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array([1, 1]),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([1]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array([-1]),
  }
  const solver = new ExposedConflictAwareSolver(topology, problem)

  expect(solver.skipGreedyTimeoutFallback()).toBe(false)
  expect(solver.solved).toBe(false)
  expect(solver.stats).toMatchObject({
    skippedUnconstrainedGreedyFinalRouteOnTimeout: true,
    greedyFinalRouteRemainingRouteCount: 1,
  })
})
