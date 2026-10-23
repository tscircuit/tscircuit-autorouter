import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver } from "tiny-hypergraph/lib/distance-aware-tiny-hypergraph-solver"
import { DetailedRoutingConflictCosts } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/DetailedRoutingConflictCosts"
import { captureDetailedRoutingIncumbent, createDetailedRoutingAnytimeSolverClass } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/DetailedRoutingIncumbent"
import { createDetailedIncumbentFixture } from "../fixtures/createDetailedIncumbentFixture"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"

test("a feedback search preserves a proven complete incumbent before the unchanged native cap and keeps physical assignments separate", (): void => {
  const { topology, problem } = createDetailedIncumbentFixture()
  const ordinary = new DistanceAwareTinyHyperGraphSolver(structuredClone(topology), structuredClone(problem))
  ordinary.solve()
  expect(ordinary.solved).toBe(true)
  const incumbent = captureDetailedRoutingIncumbent("exact-source-topology-and-preloads", ordinary)
  const penalties = [{ capacityMeshNodeId: "conflict", connectionName: "a", penalty: 8, evidenceKey: "failed-owned-node" }]
  const costs = new DetailedRoutingConflictCosts(penalties)
  const Anytime = createDetailedRoutingAnytimeSolverClass(SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments, costs, incumbent, penalties)
  const capped = new Anytime(structuredClone(topology), structuredClone(problem), { MAX_ITERATIONS: 3 })
  expect(capped.MAX_ITERATIONS).toBe(3)
  expect(capped.problem.initialAssignments).toEqual(problem.initialAssignments)
  expect(capped.state.unroutedRoutes).toEqual([0])
  const nativeStart = new SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments(structuredClone(topology), structuredClone(problem), { MAX_ITERATIONS: 3 })
  expect(capped.state.regionSegments).toEqual(nativeStart.state.regionSegments)
  expect(capped["routeSuccessCountByRouteId"]).toEqual(nativeStart["routeSuccessCountByRouteId"])
  expect(capped.stats.detailedIncumbentInstalled).toBe(1)
  capped.solve()
  expect(capped.solved, capped.error ?? "").toBe(true)
  expect(capped.failed).toBe(false)
  expect(capped.stats.acceptedBestSolutionOnTimeout).toBe(true)
  expect(capped.stats.detailedIncumbentAcceptedAtNativeBudget).toBe(1)
  expect(costs.stats.detailedConflictPenaltyApplications).toBeGreaterThan(0)
  expect(capped.state.regionSegments).toEqual(ordinary.state.regionSegments)
  expect(capped.problem.initialAssignments).toEqual(problem.initialAssignments)
  const refined = new Anytime(structuredClone(topology), structuredClone(problem), { MAX_ITERATIONS: 1000 })
  refined.solve()
  expect(refined.solved, refined.error ?? "").toBe(true)
  expect(refined.state.regionSegments[1]).toEqual([])
  expect(refined.state.regionSegments[2]!.length).toBe(1)
  expect(refined.state.regionSegments[4]).toEqual(ordinary.state.regionSegments[4])
  expect(costs.stats.detailedConflictPenaltyApplications).toBeGreaterThan(0)
  const Cold = createDetailedRoutingAnytimeSolverClass(SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments, new DetailedRoutingConflictCosts(penalties), undefined, penalties)
  const cold = new Cold(structuredClone(topology), structuredClone(problem), { MAX_ITERATIONS: 1000 })
  cold.solve()
  expect(refined.state.regionSegments).toEqual(cold.state.regionSegments)
  expect(refined.iterations).toBe(cold.iterations)
})
