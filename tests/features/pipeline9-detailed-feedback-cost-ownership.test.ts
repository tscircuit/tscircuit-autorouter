import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver } from "tiny-hypergraph/lib/distance-aware-tiny-hypergraph-solver"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { DetailedRoutingConflictCosts } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/DetailedRoutingConflictCosts"

test("route-owned detailed conflict costs change a real upstream choice without removing the penalized path", (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 7, regionCount: 4,
    regionIncidentPorts: [[0, 1, 5], [1, 2], [5, 6], [2, 6, 4]],
    incidentPortRegion: [[0], [0, 1], [1, 3], [], [3], [0, 2], [2, 3]],
    regionWidth: new Float64Array([2, 2, 2, 2]), regionHeight: new Float64Array([2, 2, 2, 2]),
    regionCenterX: new Float64Array([-2, 0, 0, 2]), regionCenterY: new Float64Array([0, 0, 1, 0]),
    regionAvailableZMask: new Int32Array([3, 3, 3, 3]),
    regionMetadata: ["start", "conflict", "detour", "end"].map((capacityMeshNodeId) => ({ capacityMeshNodeId })),
    portAngleForRegion1: new Int32Array([18000, 0, 0, 0, 0, 3000, 33000]),
    portAngleForRegion2: new Int32Array([0, 18000, 18000, 0, 0, 18000, 15000]),
    portX: new Float64Array([-3, -1, 1, 0, 3, -1, 1]),
    portY: new Float64Array([0, 0, 0, 0, 0, 1, 1]), portZ: new Int32Array(7),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1, routeStartPort: new Int32Array([0]), routeEndPort: new Int32Array([4]),
    routeNet: new Int32Array([0]), regionNetId: new Int32Array([-1, -1, -1, -1]),
    portSectionMask: new Int8Array(7).fill(1), routeMetadata: [{ connectionId: "a" }],
  }
  const ordinary = new DistanceAwareTinyHyperGraphSolver(structuredClone(topology), structuredClone(problem))
  ordinary.solve()
  expect(ordinary.solved).toBe(true)
  expect(ordinary.state.regionSegments[1]!.length).toBe(1)
  const refined = new DistanceAwareTinyHyperGraphSolver(structuredClone(topology), structuredClone(problem))
  const costs = new DetailedRoutingConflictCosts([{ capacityMeshNodeId: "conflict", connectionName: "a", penalty: 8, evidenceKey: "exact-failed-problem" }])
  costs.install(refined)
  costs.install(refined)
  refined.solve()
  expect(refined.solved).toBe(true)
  expect(refined.failed).toBe(false)
  expect(refined.state.regionSegments[1]!.length).toBe(0)
  expect(refined.state.regionSegments[2]!.length).toBe(1)
  expect(costs.stats.detailedConflictPenaltyApplications).toBeGreaterThan(0)
  expect(costs.stats.detailedConflictConfiguredSolverCount).toBe(1)
  const unrelated = new DistanceAwareTinyHyperGraphSolver(structuredClone(topology), { ...structuredClone(problem), routeMetadata: [{ connectionId: "other" }] })
  costs.install(unrelated)
  unrelated.solve()
  expect(unrelated.solved).toBe(true)
  expect(unrelated.state.regionSegments[1]!.length).toBe(1)
})
