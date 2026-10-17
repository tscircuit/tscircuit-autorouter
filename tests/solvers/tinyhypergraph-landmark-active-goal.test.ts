import { expect, test } from "bun:test"
import { initializeTinyHypergraphLandmarkHeuristic } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/initializeTinyHypergraphLandmarkHeuristic"
import {
  createDetourFixture,
  createDetourSolver,
} from "../fixtures/tinyhypergraphLandmarkHeuristicFixture"

test("goal-aware heuristic caches follow active partial goals and remain valid after rip", (): void => {
  const solver = createDetourSolver(createDetourFixture())
  const controller = initializeTinyHypergraphLandmarkHeuristic(solver)
  const port = solver.problem.routeStartPort[0]!
  const originalGoal = solver.problem.routeEndPort[0]!
  const partialGoal = solver.topology.portMetadata!.findIndex(
    (metadata): boolean => metadata.serializedPortId === "upper-left",
  )
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = solver.problem.routeNet[0]!
  solver.state.goalPortId = originalGoal
  const full = solver.computeH(port)
  expect(solver.computeH(port)).toBe(full)
  solver.state.goalPortId = partialGoal
  const partial = solver.computeH(port)
  expect(partial).toBeLessThan(full)
  expect(partial).toBe(controller.evaluateBound(port, partialGoal))
  expect(solver.computeH(partialGoal)).toBe(0)
  solver.state.ripCount = 1
  solver.state.regionCongestionCost.fill(0.1)
  solver.state.goalPortId = originalGoal
  expect(solver.computeH(port)).toBe(full)
  expect(controller.getStats().initialAltCacheHitCount).toBeGreaterThan(0)
})
