import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Single } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { searchStateParams } from "./searchStateTestUtils"

test("omitted and explicit OFF preserve serialized route, status and explored work", (): void => {
  for (const spacing of [0.05, 0.2, 2]) {
    const params = { ...searchStateParams(), minDistBetweenEnteringPoints: spacing }
    const baseline = new Single(params)
    const diagnostics: Record<string, number> = {}
    const off = new Single({ ...params, experimentSearchState: false, searchStateDiagnostics: diagnostics })
    baseline.solve()
    off.solve()
    expect(JSON.stringify(off.solvedPath)).toBe(JSON.stringify(baseline.solvedPath))
    expect([off.solved, off.failed, off.error, off.iterations]).toEqual([baseline.solved, baseline.failed, baseline.error, baseline.iterations])
    expect(off.stats).toEqual(baseline.stats)
    expect([...off.exploredNodes]).toEqual([...baseline.exploredNodes])
    expect(diagnostics).toEqual({})
  }
})
