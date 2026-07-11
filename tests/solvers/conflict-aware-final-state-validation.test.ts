import { expect, test } from "bun:test"
import { ConflictAwareTinyHyperGraphSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/conflict-aware-tiny-hyper-graph-solver"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/index"

test("conflict-aware final validation rejects strict cross-net crossings", (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 4,
    regionCount: 1,
    regionIncidentPorts: [[0, 1, 2, 3]],
    incidentPortRegion: [[0], [0], [0], [0]],
    regionWidth: new Float64Array([2]),
    regionHeight: new Float64Array([2]),
    regionCenterX: new Float64Array([0]),
    regionCenterY: new Float64Array([0]),
    regionAvailableZMask: new Int32Array([1]),
    portAngleForRegion1: new Int32Array([0, 9000, 18000, 27000]),
    portAngleForRegion2: new Int32Array([0, 0, 0, 0]),
    portX: new Float64Array([1, 0, -1, 0]),
    portY: new Float64Array([0, 1, 0, -1]),
    portZ: new Int32Array([0, 0, 0, 0]),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array([1, 1, 1, 1]),
    routeStartPort: new Int32Array([0, 1]),
    routeEndPort: new Int32Array([2, 3]),
    routeNet: new Int32Array([0, 1]),
    regionNetId: new Int32Array([-1]),
  }
  const solver = new ConflictAwareTinyHyperGraphSolver(topology, problem)
  solver.state.regionSegments[0] = [
    [0, 0, 2],
    [1, 1, 3],
  ]

  expect(() =>
    solver.assertNoStrictCrossNetCrossingsInCommittedState(),
  ).toThrow("accepted state contains a strict cross-net crossing")
})
