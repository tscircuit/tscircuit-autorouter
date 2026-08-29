import { expect, test } from "bun:test"
import { TransactionalCopperStore } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import {
  createHybridRoutingTestProblem,
  createHybridSegmentTransaction,
} from "./fixtures"

test("revalidates a stale delta and rejects its newly introduced conflict", () => {
  const problem = createHybridRoutingTestProblem()
  const store = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 4,
  })
  const first = createHybridSegmentTransaction({
    problem,
    transactionId: "authoritative-copper",
    connectionName: "bus_0",
    start: { x: -8, y: -0.5 },
    end: { x: -2, y: -0.5 },
  })
  const stale = createHybridSegmentTransaction({
    problem,
    transactionId: "stale-copper",
    connectionName: "bus_1",
    start: { x: -8, y: -0.7 },
    end: { x: -2, y: -0.7 },
  })
  expect(store.commit(first).status).toBe("committed")

  const result = store.validate(stale)

  expect(result.status).toBe("rejected")
  if (result.status !== "rejected") return
  expect(result.wasStaleRevalidation).toBe(true)
  expect(result.rejection.code).toBe("stale_conflict")
  expect(result.validatedAtCopperVersion).toBe(1)
})
