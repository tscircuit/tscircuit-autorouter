import { expect, test } from "bun:test"
import { RelaxTraceClearanceSolver } from "@tscircuit/repair04"
import { SharedElectricalTreeClearanceSolver } from "lib/solvers/SharedElectricalTreeClearanceSolver/SharedElectricalTreeClearanceSolver"
import { sharedElectricalTreeClearanceFixture } from "../fixtures/sharedElectricalTreeClearanceFixture"

test("unique primitive scheduling retains the original raw ceiling and exactly256sweeps for empty, separated and contacting scenes", (): void => {
  for (const mode of ["empty", "no-obstacle", "far-obstacle", "contact"] as const) {
    const { adapter, srj } = sharedElectricalTreeClearanceFixture()
    const routes = mode === "empty" ? [] : adapter.routes
    const obstacles = mode === "empty" || mode === "no-obstacle" ? [] : mode === "far-obstacle" ? [{ ...srj.obstacles[0]!, center: { x: 100, y: 100 } }] : srj.obstacles
    const input = { srj: { ...srj, obstacles, traces: undefined }, routes, bounds: srj.bounds, boundaryMargin: 0,
      lockedPointIndices: mode === "empty" ? [] : adapter.lockedPointIndices, traceClearance: 0.1, viaClearance: 0.1, allowViaMovement: true }
    const native = new RelaxTraceClearanceSolver(structuredClone(input))
    const solver = new SharedElectricalTreeClearanceSolver({ ...input, segmentIdentityByRoute: mode === "empty" ? [] : adapter.segmentIdentityByRoute })
    expect(solver.MAX_ITERATIONS).toBe(1024)
    native.step()
    solver.solve()
    expect(solver.failed).toBe(false)
    expect(solver.stats.treePrimitiveSweeps).toBe(256)
    expect(solver.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
    expect(solver.stats.treePrimitiveOriginalWalkIterationCeiling).toBe(native.MAX_ITERATIONS)
    expect(solver.iterations).toBeLessThanOrEqual(native.MAX_ITERATIONS)
    expect(solver.stats.treePrimitiveFinalIterations).toBe(solver.iterations)
    if (mode === "contact") expect(solver.stats.treePrimitiveRetainedPadConstraints).toBeGreaterThan(0)
    else expect(solver.stats.treePrimitiveRetainedPadConstraints).toBe(0)
  }
})
