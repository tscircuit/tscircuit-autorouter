import { expect, test } from "bun:test"
import { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { createNativeGridSetupDiagnostics, deferNativeGridSetup, type NativeGridSetupDiagnostics } from "lib/solvers/HyperHighDensitySolver/deferNativeGridSetup"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("native setup eligibility retains original failures and only defers the proved budget regime", (): void => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "eligibility", center: { x: 0, y: 0 }, width: 1, height: 1, availableZ: [0, 1], portPoints: [] }
  const diagnostics: NativeGridSetupDiagnostics = createNativeGridSetupDiagnostics()
  for (const family of ["a01", "a03"] as const) {
    const props = { nodeWithPortPoints: node, cellSizeMm: 0.1, highResolutionCellSize: 0.1, lowResolutionCellSize: 0.4, viaDiameter: 0.3 }
    const capped = family === "a01" ? new HighDensitySolverA01({ ...props, maxCellCount: 1 }) : new HighDensitySolverA03({ ...props, maxCellCount: 1 })
    const original = capped._setup
    expect(deferNativeGridSetup(capped, 150_000, diagnostics)).toBe(false)
    expect(capped._setup).toBe(original)
    capped.setup()
    expect(capped.failed).toBe(true)
    expect(capped.error).toContain("exceeds maxCellCount")
    const largeBudget = family === "a01" ? new HighDensitySolverA01(props) : new HighDensitySolverA03(props)
    expect(deferNativeGridSetup(largeBudget, 2_000_001, diagnostics)).toBe(false)
    expect(largeBudget.MAX_ITERATIONS).toBe(100_000_000)
    const penaltyCallback = family === "a01" ? new HighDensitySolverA01({ ...props, initialPenaltyFn: () => 0 }) : new HighDensitySolverA03({ ...props, initialPenaltyFn: () => 0 })
    expect(deferNativeGridSetup(penaltyCallback, 150_000, diagnostics)).toBe(false)
    const invalid = family === "a01" ? new HighDensitySolverA01({ ...props, nodeWithPortPoints: { ...node, width: Number.NaN } }) : new HighDensitySolverA03({ ...props, lowResolutionCellSize: 0.25 })
    expect(deferNativeGridSetup(invalid, 150_000, diagnostics)).toBe(false)
    if (family === "a03") {
      invalid.setup()
      expect(invalid.failed).toBe(true)
      expect(invalid.error).toContain("positive integer multiple")
    }
    const throwing = family === "a01" ? new HighDensitySolverA01(props) : new HighDensitySolverA03(props)
    throwing._setup = (): void => { throw new Error("native setup invariant") }
    expect(deferNativeGridSetup(throwing, 150_000, diagnostics)).toBe(true)
    expect(() => throwing.step()).toThrow("native setup invariant")
    expect(throwing.solved).toBe(false)
  }
})
