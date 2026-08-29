import { expect, test } from "bun:test"
import { TransactionalCopperStore } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import { createHybridRoutingTestProblem, createHybridViaTransaction } from "./fixtures"

test("rejects a connected-pad via when compiled via-in-pad policy is disabled", () => {
  const problem = createHybridRoutingTestProblem()
  const store = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 4,
  })
  const result = store.validate(
    createHybridViaTransaction({
      problem,
      transactionId: "connected-pad-via",
      connectionName: "signal_plain",
      points: [{ x: 0, y: 0 }],
    }),
  )

  expect(result.status).toBe("rejected")
  if (result.status !== "rejected") return
  expect(result.rejection.code).toBe("obstacle_clearance_violation")
  expect(result.rejection.message).toContain("via-in-pad is disabled")
})
