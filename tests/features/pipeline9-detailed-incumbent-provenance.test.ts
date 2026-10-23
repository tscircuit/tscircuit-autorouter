import { expect, test } from "bun:test"
import { DistanceAwareTinyHyperGraphSolver } from "tiny-hypergraph/lib/distance-aware-tiny-hypergraph-solver"
import { DetailedRoutingConflictCosts } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/DetailedRoutingConflictCosts"
import { captureDetailedRoutingIncumbent, createDetailedRoutingAnytimeSolverClass } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/DetailedRoutingIncumbent"
import { createDetailedIncumbentFixture } from "../fixtures/createDetailedIncumbentFixture"

test("changed geometry, ownership and incomplete incumbent segments fail before native search rather than becoming feasible cap acceptance", (): void => {
  const { topology, problem } = createDetailedIncumbentFixture()
  const original = new DistanceAwareTinyHyperGraphSolver(structuredClone(topology), structuredClone(problem))
  expect(() => captureDetailedRoutingIncumbent("source", original)).toThrow("complete successful coarse routing")
  original.solve()
  const incumbent = captureDetailedRoutingIncumbent("source", original)
  const penalties = [{ capacityMeshNodeId: "conflict", connectionName: "a", penalty: 8, evidenceKey: "failed-node" }]
  const Anytime = createDetailedRoutingAnytimeSolverClass(DistanceAwareTinyHyperGraphSolver, new DetailedRoutingConflictCosts(penalties), incumbent, penalties)
  const moved = structuredClone(topology)
  moved.portX[1] += 0.01
  expect(() => new Anytime(moved, structuredClone(problem))).toThrow("ports no longer match")
  const renamed = structuredClone(problem)
  renamed.routeNet[0] = 9
  expect(() => new Anytime(structuredClone(topology), renamed)).toThrow("routes no longer match")
  const broken = structuredClone(incumbent)
  broken.segments = broken.segments.filter((segment) => segment.route !== "a" || segment.region !== "conflict")
  const Broken = createDetailedRoutingAnytimeSolverClass(DistanceAwareTinyHyperGraphSolver, new DetailedRoutingConflictCosts(penalties), broken, penalties)
  expect(() => new Broken(structuredClone(topology), structuredClone(problem))).toThrow("do not connect")
  expect(incumbent.segments.length).toBeGreaterThan(0)
  expect(problem.initialAssignments).toHaveLength(1)
})
