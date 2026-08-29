import { expect, test } from "bun:test"
import { TransactionalCopperStore } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import {
  createHybridRoutingTestProblem,
  createHybridSegmentTransaction,
} from "./fixtures"

test("rolls back by discarding a validated but uncommitted delta", () => {
  const problem = createHybridRoutingTestProblem()
  const store = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 4,
  })
  const before = store.getSnapshot()
  const delta = createHybridSegmentTransaction({
    problem,
    transactionId: "discarded-candidate",
    connectionName: "signal_plain",
    start: { x: -8, y: 2.5 },
    end: { x: 8, y: 2.5 },
  })

  expect(store.validate(delta).status).toBe("accepted")
  const after = store.getSnapshot()

  expect(after).toEqual(before)
  expect(store.getCommittedTransactions()).toEqual([])
})
