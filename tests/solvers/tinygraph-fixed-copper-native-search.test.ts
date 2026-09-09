import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { createTinyGraphFixedCopperClearanceContext } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createTinyGraphFixedCopperClearanceContext"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/index"

test("native graph search takes an existing legal portal instead of a foreign-pad portal", (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 4,
    regionCount: 2,
    regionIncidentPorts: [
      [0, 1, 3],
      [1, 2, 3],
    ],
    incidentPortRegion: [[0], [0, 1], [1], [0, 1]],
    regionWidth: new Float64Array([1, 1]),
    regionHeight: new Float64Array([2, 2]),
    regionCenterX: new Float64Array([-0.5, 0.5]),
    regionCenterY: new Float64Array([0, 0]),
    regionAvailableZMask: new Int32Array([1, 1]),
    portAngleForRegion1: new Int32Array([18000, 0, 0, 4500]),
    portAngleForRegion2: new Int32Array([0, 18000, 0, 13500]),
    portX: new Float64Array([-1, 0, 1, 0]),
    portY: new Float64Array([0, 0, 0, 0.5]),
    portZ: new Int32Array([0, 0, 0, 0]),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([2]),
    routeNet: new Int32Array([7]),
    regionNetId: new Int32Array([-1, -1]),
    portSectionMask: new Int8Array(4).fill(1),
    routeMetadata: [
      { connectionId: "route-a", mutuallyConnectedNetworkId: "net-a" },
    ],
  }
  const index = new FixedCopperClearanceIndex({
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 0.2,
        zLayers: [0],
        ownerNetIds: new Set(["pad-net-with-no-route"]),
      },
    ],
    layerCount: 2,
    minClearance: 0.05,
  })
  const solver =
    new SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments(
      topology,
      problem,
      undefined,
      createTinyGraphFixedCopperClearanceContext({
        problem,
        clearanceIndex: index,
        traceWidth: 0.1,
      }),
    )
  solver.solve()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect([...solver.state.portAssignment]).toEqual([7, -1, 7, 7])
})
