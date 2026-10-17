import { expect, test } from "bun:test"
import { initializeTinyHypergraphLandmarkHeuristic } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/initializeTinyHypergraphLandmarkHeuristic"
import {
  createDetourFixture,
  createDetourSolver,
  getReferenceDistances,
} from "../fixtures/tinyhypergraphLandmarkHeuristicFixture"

test("directed landmark bounds are admissible and consistent with penalties, layers and disconnected components", (): void => {
  const solver = createDetourSolver(createDetourFixture())
  const reference = getReferenceDistances(solver)
  const controller = initializeTinyHypergraphLandmarkHeuristic(solver)
  const portCount = solver.topology.portCount
  let admissibilityViolation = 0
  let consistencyViolation = 0
  let allFinite = true
  for (let goal = 0; goal < portCount; goal++) {
    const bounds = Array.from(
      { length: portCount },
      (_, portId): number => controller.evaluateBound(portId, goal),
    )
    allFinite &&= bounds.every(Number.isFinite)
    expect(bounds[goal]).toBe(0)
    for (let first = 0; first < portCount; first++) {
      admissibilityViolation = Math.max(
        admissibilityViolation,
        bounds[first]! - reference.distances[first]![goal]!,
      )
      for (let second = 0; second < portCount; second++) {
        consistencyViolation = Math.max(
          consistencyViolation,
          bounds[first]! - reference.edges[first]![second]! - bounds[second]!,
        )
      }
    }
  }
  expect(allFinite).toBeTrue()
  expect(admissibilityViolation).toBeLessThan(1e-12)
  expect(consistencyViolation).toBeLessThan(1e-12)
  const goal = solver.problem.routeEndPort[0]!
  const start = solver.problem.routeStartPort[0]!
  const euclidean =
    Math.hypot(
      solver.topology.portX[start]! - solver.topology.portX[goal]!,
      solver.topology.portY[start]! - solver.topology.portY[goal]!,
    ) * solver.DISTANCE_TO_COST
  expect(controller.evaluateBound(start, goal)).toBeGreaterThan(euclidean)
  expect(controller.evaluateBound(start, goal)).toBeCloseTo(
    reference.distances[start]![goal]!,
    10,
  )
  expect(controller.getStats().initialAltLandmarkCount).toBe(4)
})
