import { expect, test } from "bun:test"
import { LazyPhysicalSingleHighDensityRouteSolver as Lazy } from "lib/solvers/HighDensitySolver/LazyPhysicalSingleHighDensityRouteSolver"
import { options } from "./lazyPhysicalTestUtils"

test("shared diagnostics retain live, failed, and solved route work independently of stable solver stats", () => {
  const ledger: Record<string, number> = {}
  const loser = new Lazy(options(), ledger)
  const winner = new Lazy(options(), ledger)
  loser.MAX_ITERATIONS = 0
  loser.step()
  expect(loser.failed).toBe(true)
  expect(ledger.lazyInstances).toBe(2)
  expect(ledger.lazyStepCalls).toBe(1)
  winner.step()
  expect(ledger.lazyStepCalls).toBe(2)
  winner.solve()
  expect(winner.solved).toBe(true)
  for (const key of Object.keys(winner.lazyPhysicalDiagnostics)) {
    expect(ledger[key]).toBe(winner.lazyPhysicalDiagnostics[key] + loser.lazyPhysicalDiagnostics[key])
  }
  expect(winner.stats).toEqual({})
  expect(loser.stats).toEqual({})
})
