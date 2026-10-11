import { expect, test } from "bun:test"
import { createPlanarSeedFixture, createPlanarSeedTestSolver, snapshotPlanarSeedState } from "../fixtures/tinyhypergraph-planar-seed"

test("a missing independent chain fails before any planar seed or history is committed", (): void => {
  const { graph, segments } = createPlanarSeedFixture()
  const solver = createPlanarSeedTestSolver(graph)
  const incomplete = segments.filter((segment) => !(segment.connectionId === "upper-route" && segment.regionId === "right"))
  const stateBefore = solver.state
  const snapshotBefore = snapshotPlanarSeedState(solver)

  expect(() => solver.initializePlanarSeed(incomplete)).toThrow("does not connect its exact endpoints")
  expect(solver.state).toBe(stateBefore)
  expect(snapshotPlanarSeedState(solver)).toEqual(snapshotBefore)
  expect(solver.solved).toBeFalse()
})
