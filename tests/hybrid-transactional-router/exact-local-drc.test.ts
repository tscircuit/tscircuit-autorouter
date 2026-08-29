import { expect, test } from "bun:test"
import { TransactionalCopperStore } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import {
  createHybridSegmentTransaction,
  createHybridUncoupledRoutingTestProblem,
} from "./fixtures"

test("rejects foreign copper whose exact edge clearance is too small", () => {
  const problem = createHybridUncoupledRoutingTestProblem()
  const store = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 4,
  })
  const first = createHybridSegmentTransaction({
    problem,
    transactionId: "first-copper",
    connectionName: "bus_0",
    start: { x: -8, y: -0.5 },
    end: { x: -2, y: -0.5 },
  })
  expect(store.commit(first).status).toBe("committed")
  const tooClose = createHybridSegmentTransaction({
    problem,
    transactionId: "too-close-copper",
    connectionName: "bus_1",
    start: { x: -8, y: -0.7 },
    end: { x: -2, y: -0.7 },
    baseCopperVersion: 1,
  })

  const result = store.validate(tooClose)

  expect(result.status).toBe("rejected")
  if (result.status !== "rejected") return
  expect(result.rejection.code).toBe("copper_clearance_violation")
  expect(result.rejection.conflictingCopperIds).toEqual([
    "too-close-copper:segment",
    "first-copper:segment",
  ])
  expect(result.drcPredicateCalls).toBeGreaterThan(0)
})
