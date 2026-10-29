import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Single } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { searchStateParams } from "./searchStateTestUtils"

test("a fine-grid synthetic route preserves output and explored work", (): void => {
  const params = { ...searchStateParams(), minDistBetweenEnteringPoints: 0.05 }
  const baseline = new Single(params)
  const candidate = new Single({ ...params, experimentSearchState: true })
  baseline.solve()
  candidate.solve()
  expect(baseline.cellStep).toBe(0.05)
  expect(baseline.solved).toBe(true)
  expect(candidate.solved).toBe(true)
  expect(candidate.solvedPath).toEqual(baseline.solvedPath)
  expect(candidate.iterations).toBe(baseline.iterations)
  expect([...candidate.exploredNodes]).toEqual([...baseline.exploredNodes])
  expect(candidate.stats.searchStateDirectedEdgeRejections).toBeUndefined()
})
