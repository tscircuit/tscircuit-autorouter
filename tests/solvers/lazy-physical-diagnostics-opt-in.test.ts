import { expect, test } from "bun:test"
import { LazyPhysicalSingleHighDensityRouteSolver as Lazy } from "lib/solvers/HighDensitySolver/LazyPhysicalSingleHighDensityRouteSolver"
import { options } from "./lazyPhysicalTestUtils"

test("detailed work counting is opt-in, snapshotted, and preserves the complete routing policy", () => {
  const previous = Lazy.detailedWorkDiagnostics
  try {
    const leanLedger: Record<string, number> = {}, detailedLedger: Record<string, number> = {}
    Lazy.detailedWorkDiagnostics = false
    const lean = new Lazy(options(), leanLedger)
    Lazy.detailedWorkDiagnostics = true
    const detailed = new Lazy(options(), detailedLedger)
    expect(lean.detailedWorkDiagnosticsEnabled).toBe(false)
    expect(detailed.detailedWorkDiagnosticsEnabled).toBe(true)
    lean.solve()
    detailed.solve()
    expect(lean.solved).toBe(true)
    expect(lean.solvedPath).toEqual(detailed.solvedPath)
    expect(lean.iterations).toBe(detailed.iterations)
    expect(lean.exploredNodes).toEqual(detailed.exploredNodes)
    expect(lean.lazyPhysicalDiagnostics).toEqual({ lazyInstances: 1 })
    expect(leanLedger).toEqual({ lazyInstances: 1 })
    expect(detailedLedger.lazyDetailedInstances).toBe(1)
    expect(detailedLedger.lazyWorkUnits).toBeGreaterThan(0)
    expect(detailedLedger.lazySegmentChecks).toBeGreaterThan(0)
  } finally {
    Lazy.detailedWorkDiagnostics = previous
  }
})
