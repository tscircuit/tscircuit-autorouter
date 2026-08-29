import { expect, test } from "bun:test"
import { TransactionalCopperStore } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import {
  createHybridRoutingTestProblem,
  createHybridSegmentTransaction,
} from "./fixtures"

test("retains only the configured number of committed transaction records", () => {
  const problem = createHybridRoutingTestProblem()
  const store = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 2,
  })
  for (let transactionIndex = 0; transactionIndex < 3; transactionIndex++) {
    const result = store.commit(
      createHybridSegmentTransaction({
        problem,
        transactionId: `bounded-history-${transactionIndex}`,
        connectionName: "signal_plain",
        start: { x: -7, y: 4 + transactionIndex * 0.5 },
        end: { x: -5, y: 4 + transactionIndex * 0.5 },
        baseCopperVersion: transactionIndex,
      }),
    )
    expect(result.status).toBe("committed")
  }

  expect(
    store.getCommittedTransactions().map((transaction) => transaction.transactionId),
  ).toEqual(["bounded-history-1", "bounded-history-2"])
})
