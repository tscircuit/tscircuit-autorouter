import { expect, test } from "bun:test"
import { ConflictAwareTinyHyperGraphSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/conflict-aware-tiny-hyper-graph-solver"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/index"

class ZeroExpansionConflictSolver extends ConflictAwareTinyHyperGraphSolver {
  protected override getRelaxedSearchExpansionLimit(): number {
    return 0
  }
}

test("conflict blocker search fails loudly at its expansion limit", (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 1,
    regionIncidentPorts: [[0, 1]],
    incidentPortRegion: [[0], [0]],
    regionWidth: new Float64Array([1]),
    regionHeight: new Float64Array([1]),
    regionCenterX: new Float64Array([0.5]),
    regionCenterY: new Float64Array([0]),
    regionAvailableZMask: new Int32Array([1]),
    portAngleForRegion1: new Int32Array([18000, 0]),
    portAngleForRegion2: new Int32Array([0, 0]),
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
  const solver = new ZeroExpansionConflictSolver(topology, problem)
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 0

  expect(() => solver.onOutOfCandidates()).toThrow(
    "exceeded its 0-label expansion limit",
  )
})
