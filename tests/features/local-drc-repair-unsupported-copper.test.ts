import { expect, test } from "bun:test"
import { LocalDrcRepairSolver } from "lib/solvers/LocalDrcRepairSolver/LocalDrcRepairSolver"
import { createLocalDrcRepairFixture } from "../fixtures/local-drc-repair-fixture"

test("cleanup leaves blind vias and disconnected route components unchanged", (): void => {
  for (const geometry of ["blind", "disconnected"]) {
    const input = createLocalDrcRepairFixture()
    if (geometry === "blind") input.originalSrj.allowBlindAndBuriedVias = true
    else input.traces[0]!.route[3] = { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "bottom" }
    const before = structuredClone(input.traces)
    const solver = new LocalDrcRepairSolver(input)
    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    expect(solver.stats.unsupportedGeometry).toBeTrue()
    expect(solver.getOutput()).toEqual(before)
  }
})
