import { expect, test } from "bun:test"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { createScatteredBoundedRegionalRepairFixture } from "../fixtures/createScatteredBoundedRegionalRepairFixture"

test("regional phase timing accumulates child phases without changing the repair", (): void => {
  const fixture = createScatteredBoundedRegionalRepairFixture()
  const solver = new Pipeline9BoundedRegionalRepairSolver({
    ...fixture,
    budget: {
      maxRegions: 1,
      maxCandidateAttempts: 1,
      maxPathSearchNodes: 5_000,
    },
  })
  while (!solver.solved && !solver.failed) solver.step()
  expect(solver.failed).toBeFalse()
  expect(solver.getResult().acceptedRegionCount).toBe(1)
  expect(solver.phaseTimeMs["initial-reference"]).toBeGreaterThanOrEqual(0)
  expect(solver.phaseTimeMs["initial-projection"]).toBeGreaterThanOrEqual(0)
  expect(solver.phaseTimeMs.negotiate).toBeGreaterThanOrEqual(0)
  expect(solver.stats.phaseTimeMs).toEqual(solver.phaseTimeMs)
})
