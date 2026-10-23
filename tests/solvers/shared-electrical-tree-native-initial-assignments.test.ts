import { expect, test } from "bun:test"
import { ElectricalTreeTinyHyperGraphSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/ElectricalTreeTinyHyperGraphSolver"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"

test("constrained native nets retain duplicate and zero-length initial cache assignments during base construction and rerip", (): void => {
  const topology: TinyHyperGraphTopology = { portCount: 2, regionCount: 1,
    regionIncidentPorts: [[0, 1]], incidentPortRegion: [[0], [0]],
    regionWidth: new Float64Array([10]), regionHeight: new Float64Array([10]),
    regionCenterX: new Float64Array([0]), regionCenterY: new Float64Array([0]), regionAvailableZMask: new Int32Array([1]),
    portAngleForRegion1: new Int32Array([0, 18000]), portAngleForRegion2: new Int32Array(2),
    portX: new Float64Array([-1, 1]), portY: new Float64Array(2), portZ: new Int32Array(2) }
  const problem: TinyHyperGraphProblem = { routeCount: 3, portSectionMask: new Int8Array(2).fill(1),
    routeStartPort: new Int32Array([0, 0, 1]), routeEndPort: new Int32Array([1, 1, 1]), routeNet: new Int32Array([0, 0, 0]),
    regionNetId: new Int32Array([-1]), routeMetadata: [{}, { electricalTreeNativePath: true }, {}],
    initialAssignments: [{ routeId: 0, regionId: 0, fromPortId: 0, toPortId: 1 },
      { routeId: 1, regionId: 0, fromPortId: 0, toPortId: 1 }, { routeId: 2, regionId: 0, fromPortId: 1, toPortId: 1 }] }
  const native = new SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments(topology, problem)
  const experiment = new ElectricalTreeTinyHyperGraphSolver(topology, problem)
  expect(native.state.regionIntersectionCaches[0]!.existingSegmentCount).toBe(3)
  expect(experiment.state.regionIntersectionCaches).toEqual(native.state.regionIntersectionCaches)
  expect(experiment.state.regionSegments).toEqual(native.state.regionSegments)
  expect(experiment.state.portAssignment).toEqual(native.state.portAssignment)
  native.resetRoutingStateForRerip()
  experiment.resetRoutingStateForRerip()
  expect(experiment.state.regionIntersectionCaches).toEqual(native.state.regionIntersectionCaches)
  expect(experiment.state.regionSegments).toEqual(native.state.regionSegments)
  native.solve()
  experiment.solve()
  expect(experiment.solved).toBe(native.solved)
  expect(experiment.failed).toBe(native.failed)
  expect(experiment.state.regionIntersectionCaches).toEqual(native.state.regionIntersectionCaches)
  expect(experiment.stats.electricalTreeTargetCount).toBe(0)
  expect(experiment.stats.electricalTreeSharedCacheReferenceCount).toBe(0)
})
