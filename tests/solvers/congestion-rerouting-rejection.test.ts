import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { createCongestionFixture } from "../fixtures/congestion-rerouting"
import { CongestionReroutingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/CongestionReroutingSolver"

test("rejects a detour that merely transfers the crossing to another box", (): void => {
  const input = createCongestionFixture()
  const topology = structuredClone(input.solver.topology)
  topology.portCount += 2
  topology.portX = Float64Array.from([...topology.portX, 0, 0])
  topology.portY = Float64Array.from([...topology.portY, 1.45, 1.55])
  topology.portZ = Int32Array.from([...topology.portZ, 0, 0])
  topology.portAngleForRegion1 = Int32Array.from([
    ...topology.portAngleForRegion1,
    27000,
    9000,
  ])
  topology.portAngleForRegion2 = Int32Array.from([
    ...topology.portAngleForRegion2!,
    0,
    0,
  ])
  topology.incidentPortRegion.push([5], [5])
  topology.regionIncidentPorts[5].push(10, 11)
  topology.regionCenterY[5] = 1.5
  topology.regionWidth[5] = 0.1
  topology.portX[8] = -0.05
  topology.portX[9] = 0.05
  topology.portAngleForRegion2[8] = 18000
  topology.portAngleForRegion1[9] = 0
  topology.regionAvailableZMask![5] = 3
  topology.regionHeight[5] = 0.1
  const problem = {
    ...input.solver.problem,
    routeCount: 3,
    portSectionMask: new Int8Array(12).fill(1),
    routeStartPort: Int32Array.from([4, 6, 10]),
    routeEndPort: Int32Array.from([5, 7, 11]),
    routeNet: Int32Array.from([0, 1, 2]),
    initialAssignments: [
      ...input.solver.problem.initialAssignments!,
      { routeId: 2, regionId: 5, fromPortId: 10, toPortId: 11 },
    ],
  }
  const incumbent = new TinyHyperGraphSolver(topology, problem, {
    RIP_THRESHOLD_START: 100,
    RIP_THRESHOLD_END: 100,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
  })
  incumbent.solve()
  input.nodesByRegionId.set(5, {
    capacityMeshNodeId: "5",
    center: { x: 0, y: 1.5 },
    width: 0.1,
    height: 0.1,
    availableZ: [0, 1],
    layer: "top",
  })
  const solver = new CongestionReroutingSolver({
    ...input,
    solver: incumbent,
    preservedRouteIds: new Set([1, 2]),
  })
  solver.solve()
  expect(solver.rejected).toBe(1)
  expect(solver.accepted).toBe(0)
  expect(solver.getOutput()).toBe(incumbent)
})
