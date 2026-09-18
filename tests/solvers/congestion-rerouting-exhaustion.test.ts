import { expect, test } from "bun:test"
import { createCongestionFixture } from "../fixtures/congestion-rerouting"
import { CongestionReroutingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/CongestionReroutingSolver"

test("bounded unsuccessful searches retain the complete incumbent", (): void => {
  for (const options of [
    { maxAttempts: 0 },
    { maxAttempts: 1 },
    { maxIterationsPerAttempt: 1 },
    {},
  ]) {
    const input = createCongestionFixture(true)
    const solver = new CongestionReroutingSolver({ ...input, ...options })
    solver.solve()
    expect(solver.failed).toBe(false)
    expect(solver.getOutput()).toBe(input.solver)
    expect(solver.accepted).toBe(0)
    expect(solver.attempts).toBeLessThanOrEqual(options.maxAttempts ?? 2)
  }
})
