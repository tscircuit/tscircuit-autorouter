import { expect, test } from "bun:test"
import { createPlanarSeedFixture, createPlanarSeedTestSolver, snapshotPlanarSeedState } from "../fixtures/tinyhypergraph-planar-seed"

test("an unknown forecast connection fails atomically instead of disappearing from the planar seed", (): void => {
  const { graph, segments } = createPlanarSeedFixture()
  const solver = createPlanarSeedTestSolver(graph)
  const unknown = [...segments, { ...segments[0], connectionId: "unknown-route" }]
  const stateBefore = solver.state
  const snapshotBefore = snapshotPlanarSeedState(solver)

  expect(() => solver.initializePlanarSeed(unknown)).toThrow('unknown connection "unknown-route"')
  expect(solver.state).toBe(stateBefore)
  expect(snapshotPlanarSeedState(solver)).toEqual(snapshotBefore)
  expect(solver.solved).toBeFalse()
})
