import { expect, test } from "bun:test"
import { NegotiateTraceClearanceSolver as NativeNegotiate } from "@tscircuit/repair04"
import { NegotiateTraceClearanceSolver } from "lib/solvers/RepairSearchScratch/native/NegotiateTraceClearanceSolver"
import { createRepairSearchScratchStats } from "lib/solvers/RepairSearchScratch/RepairSearchScratchStats"
import { negotiationInput } from "../../fixtures/repair04StepFixtures"
import { runStepParity } from "../../fixtures/repair-search-scratch/stepParity"

test("complete synthetic negotiations preserve exact routes, span choices, callbacks, budgets and visible child work", (): void => {
  const ledger = createRepairSearchScratchStats()
  for (const directions of [1, 2] as const) {
    for (const maxPathSearchNodes of [0, 1024, 6000]) {
      const input = {
        ...negotiationInput,
        srj: structuredClone(negotiationInput.srj), routes: structuredClone(negotiationInput.routes),
        searchDirectionCount: directions, maxPathSearchNodes,
        maxPathSearchNodesPerCall: 1500, maxPathSearchCalls: 8,
      }
      const before = structuredClone(input.routes)
      const nativeCalls: unknown[] = [], candidateCalls: unknown[] = []
      const reference = new NativeNegotiate({ ...input, onSearch: stats => nativeCalls.push({ ...stats }) })
      const candidate = new NegotiateTraceClearanceSolver({ ...input, onSearch: stats => candidateCalls.push({ ...stats }) }, ledger)
      runStepParity(reference, candidate)
      expect(candidateCalls).toEqual(nativeCalls)
      expect(input.routes).toEqual(before)
    }
  }
  expect(ledger.neighborListsServed).toBeGreaterThan(0)
  expect(ledger.searchInstances).toBeGreaterThan(0)
})
