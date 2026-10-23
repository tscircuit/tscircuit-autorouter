import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { createPhysicalCutTinyProblem } from "../fixtures/createPhysicalCutTinyProblem"

test("cut capacity changes native allocation to another layer while same-root tasks can share layer zero", () => {
  for (const sameRoot of [false, true]) {
    const { topology, problem, tracker } = createPhysicalCutTinyProblem()
    const descriptor0 = topology.portMetadata![0].__pipeline9PhysicalCut
    const descriptor1 = { ...descriptor0, cutId: "narrow-layer1" }
    topology.portCount = 8
    topology.regionIncidentPorts = [[2, 4], [2, 4, 0, 1, 6, 7], [0, 1, 6, 7, 3, 5], [3, 5]]
    topology.incidentPortRegion = [[1, 2], [1, 2], [1, 0], [2, 3], [1, 0], [2, 3], [1, 2], [1, 2]]
    topology.regionAvailableZMask = Int32Array.from([1, 3, 3, 1])
    topology.portX = Float64Array.from([0, 0, -2, 2, -2, 2, 0, 0])
    topology.portY = Float64Array.from([-0.025, 0.025, -0.025, -0.025, 0.025, 0.025, -0.025, 0.025])
    topology.portZ = Int32Array.from([0, 0, 0, 0, 0, 0, 1, 1])
    topology.portAngleForRegion1 = new Int32Array(8)
    topology.portAngleForRegion2 = new Int32Array(8).fill(18000)
    topology.portMetadata = [{ __pipeline9PhysicalCut: descriptor0 }, { __pipeline9PhysicalCut: descriptor0 }, {}, {}, {}, {}, { __pipeline9PhysicalCut: descriptor1 }, { __pipeline9PhysicalCut: descriptor1 }]
    problem.routeCount = 2
    problem.routeStartPort = Int32Array.from([2, 4])
    problem.routeEndPort = Int32Array.from([3, 5])
    problem.routeNet = Int32Array.from([0, sameRoot ? 0 : 1])
    problem.portSectionMask = new Int8Array(8).fill(1)
    const solver = new TinyHyperGraphSolver(topology, problem, { MAX_ITERATIONS: 2000, ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true, RIP_THRESHOLD_RAMP_ATTEMPTS: 0 })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    const layerZeroOwners = new Set([solver.state.portAssignment[0], solver.state.portAssignment[1]].filter((net) => net! >= 0))
    expect(layerZeroOwners.size).toBe(1)
    if (sameRoot) {
      expect(solver.state.portAssignment[6]).toBe(-1)
      expect(solver.state.portAssignment[7]).toBe(-1)
      expect(tracker.stats.physicalCutSameNetReuse).toBeGreaterThan(0)
    } else {
      const layerOneOwners = new Set([solver.state.portAssignment[6], solver.state.portAssignment[7]].filter((net) => net! >= 0))
      expect(layerOneOwners.size).toBe(1)
      expect([...layerOneOwners][0]).not.toBe([...layerZeroOwners][0])
      expect(tracker.stats.physicalCutCapacityRejections).toBeGreaterThan(0)
    }
  }
})
