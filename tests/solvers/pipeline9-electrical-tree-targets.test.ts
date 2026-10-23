import { expect, test } from "bun:test"
import { ElectricalTreeTinyHyperGraphSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/ElectricalTreeTinyHyperGraphSolver"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { createEmptyRegionIntersectionCache, type TinyHyperGraphProblem, type TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"

class TreeProbe extends ElectricalTreeTinyHyperGraphSolver {
  removeOwner(routeId: number): void {
    this.state.portAssignment.fill(-1)
    for (let regionId = 0; regionId < this.state.regionSegments.length; regionId++) {
      this.state.regionSegments[regionId] = this.state.regionSegments[regionId]!.filter(([owner]) => owner !== routeId)
      this.state.regionIntersectionCaches[regionId] = createEmptyRegionIntersectionCache()
      for (const [owner, from, to] of this.state.regionSegments[regionId]!) {
        this.state.portAssignment[from] = this.problem.routeNet[owner]!
        this.state.portAssignment[to] = this.problem.routeNet[owner]!
        this.appendSegmentToRegionCache(regionId, from, to)
      }
    }
  }
}

test("electrical tree search reuses actual same-net copper and owns its suffix through owner removal", () => {
  const topology: TinyHyperGraphTopology = {
    portCount: 7,
    regionCount: 4,
    regionIncidentPorts: [[0, 1], [1, 2, 4], [2, 3], [5, 6]],
    incidentPortRegion: [[0], [0, 1], [1, 2], [2], [1], [3], [3]],
    regionWidth: new Float64Array([10, 10, 10, 1]),
    regionHeight: new Float64Array([10, 10, 10, 1]),
    regionCenterX: new Float64Array([5, 15, 25, 19]),
    regionCenterY: new Float64Array([0, 0, 0, 1]),
    regionAvailableZMask: new Int32Array([1, 1, 1, 1]),
    portAngleForRegion1: new Int32Array([18000, 0, 0, 0, 9000, 0, 18000]),
    portAngleForRegion2: new Int32Array([0, 18000, 18000, 0, 0, 0, 0]),
    portX: new Float64Array([0, 10, 20, 30, 19, 19, 19.1]),
    portY: new Float64Array([0, 0, 0, 0, 1, 1.01, 1.01]),
    portZ: new Int32Array(7),
    portMetadata: [
      { pcb_port_id: "tree-start" }, {}, {}, { pcb_port_id: "tree-end" },
      { pcb_port_id: "branch-start" }, {}, {},
    ],
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 3,
    portSectionMask: new Int8Array(7).fill(1),
    routeStartPort: new Int32Array([0, 4, 5]),
    routeEndPort: new Int32Array([3, 3, 6]),
    routeNet: new Int32Array([0, 0, 1]),
    regionNetId: new Int32Array(4).fill(-1),
  }
  const options = {
    RIP_THRESHOLD_START: 1,
    RIP_THRESHOLD_END: 1,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
    PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: false,
  }
  const solver = new TreeProbe(topology, problem, options)
  while (solver.state.unroutedRoutes.includes(0) || solver.state.currentRouteId === 0) solver.step()
  solver.step()
  expect(solver.state.currentRouteId).toBe(1)
  expect(solver.state.goalPortId).toBe(2)
  expect(solver.state.goalPortId).not.toBe(5)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.electricalTreeTargetCount).toBe(1)
  expect(solver.stats.electricalTreeSuffixSegmentCount).toBe(1)
  const baseline = new SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments(topology, problem, options)
  baseline.solve()
  expect(solver.state.regionSegments).toEqual(baseline.state.regionSegments)
  expect(solver.iterations).toBeLessThan(baseline.iterations)
  expect(solver.state.regionSegments[2]).toContainEqual([1, 2, 3])
  solver.removeOwner(0)
  expect(solver.state.regionSegments[2]).toEqual([[1, 2, 3]])
  expect(solver.state.regionSegments[1]).toContainEqual([1, 4, 2])
  expect(topology.portZ[2]).toBe(topology.portZ[3])
  expect(topology.portMetadata![4]!.pcb_port_id).toBe("branch-start")
  expect(topology.portMetadata![3]!.pcb_port_id).toBe("tree-end")

  const preloaded = new TreeProbe(topology, {
    ...problem,
    initialAssignments: [
      { routeId: 0, regionId: 0, fromPortId: 0, toPortId: 1 },
      { routeId: 0, regionId: 1, fromPortId: 1, toPortId: 2 },
      { routeId: 0, regionId: 2, fromPortId: 2, toPortId: 3 },
    ],
  }, options)
  preloaded.solve()
  expect(preloaded.solved).toBe(true)
  expect(preloaded.stats.electricalTreeTargetCount).toBe(0)
  expect(preloaded.state.regionSegments[2]).toContainEqual([0, 2, 3])

  const otherLayer = new TreeProbe({ ...topology, portZ: new Int32Array([0, 0, 1, 0, 0, 0, 0]) }, problem, options)
  otherLayer.solve()
  expect(otherLayer.solved).toBe(true)
  expect(otherLayer.stats.electricalTreeTargetCount).toBe(0)

  const reversed = new TreeProbe(topology, {
    ...problem,
    routeStartPort: new Int32Array([0, 3, 5]),
    routeEndPort: new Int32Array([3, 4, 6]),
  }, options)
  reversed.solve()
  expect(reversed.solved).toBe(true)
  expect(reversed.stats.electricalTreeTargetCount).toBe(1)
  expect(reversed.state.regionSegments[2]).toContainEqual([1, 2, 3])
  // Unknown net sentinels do not establish electrical equivalence.
  const unknownNetsProblem = { ...problem, routeNet: new Int32Array([-1, -1, 1]) }
  const unknownNets = new TreeProbe(topology, unknownNetsProblem, options)
  const unknownNetsBaseline = new SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments(topology, unknownNetsProblem, options)
  unknownNets.solve()
  unknownNetsBaseline.solve()
  expect(unknownNets.solved).toBe(true)
  expect(unknownNets.stats.electricalTreeTargetCount).toBe(0)
  expect(unknownNets.state.regionSegments).toEqual(unknownNetsBaseline.state.regionSegments)

})
