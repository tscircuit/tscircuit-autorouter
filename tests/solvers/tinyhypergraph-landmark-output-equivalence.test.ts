import { expect, test } from "bun:test"
import { initializeTinyHypergraphLandmarkHeuristic } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/initializeTinyHypergraphLandmarkHeuristic"
import {
  createDetourFixture,
  createDetourSolver,
} from "../fixtures/tinyhypergraphLandmarkHeuristicFixture"

test("consistent obstacle bounds preserve the unique native route while reducing dead-end expansions", (): void => {
  const graph = createDetourFixture(40)
  const baseline = createDetourSolver(graph)
  const initialized = createDetourSolver(graph)
  const nativeComputeH = initialized.computeH
  const stateBefore = JSON.stringify({
    owners: [...initialized.state.portAssignment],
    segments: initialized.state.regionSegments,
    caches: initialized.state.regionIntersectionCaches,
    pending: initialized.state.unroutedRoutes,
    history: [...initialized.state.regionCongestionCost],
    counters: [...initialized.routeSuccessCountsForTest],
  })
  const controller = initializeTinyHypergraphLandmarkHeuristic(initialized)
  expect(
    JSON.stringify({
      owners: [...initialized.state.portAssignment],
      segments: initialized.state.regionSegments,
      caches: initialized.state.regionIntersectionCaches,
      pending: initialized.state.unroutedRoutes,
      history: [...initialized.state.regionCongestionCost],
      counters: [...initialized.routeSuccessCountsForTest],
    }),
  ).toBe(stateBefore)
  baseline.solve()
  initialized.solve()
  expect(baseline.solved).toBeTrue()
  expect(initialized.solved).toBeTrue()
  expect(initialized.failed).toBeFalse()
  expect(initialized.getOutput()).toEqual(baseline.getOutput())
  expect(initialized.state.regionSegments).toEqual(baseline.state.regionSegments)
  expect(initialized.iterations).toBeLessThan(baseline.iterations)
  expect(
    controller.getStats().initialAltMaxImprovementOverEuclidean,
  ).toBeGreaterThan(0)
  expect(initialized.state.ripCount).toBe(0)
  controller.uninstall()
  expect(initialized.computeH).toBe(nativeComputeH)
  expect(controller.getStats().initialAltActive).toBeFalse()
})
