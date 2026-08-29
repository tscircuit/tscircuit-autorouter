import { expect, test } from "bun:test"
import { TransactionalCopperStore } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import {
  createHybridRoutingTestProblem,
  createHybridViaTransaction,
} from "./fixtures"

test("rejects a candidate that exceeds the compiled hard via budget", () => {
  const problem = createHybridRoutingTestProblem()
  const store = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 4,
  })
  const delta = createHybridViaTransaction({
    problem,
    transactionId: "too-many-vias",
    connectionName: "signal_plain",
    points: [
      { x: -7, y: -3 },
      { x: -6, y: -3 },
      { x: -5, y: -3 },
      { x: -4, y: -3 },
      { x: -3, y: -3 },
      { x: -2, y: -3 },
    ],
  })

  const result = store.validate(delta)

  expect(result.status).toBe("rejected")
  if (result.status !== "rejected") return
  expect(result.rejection.code).toBe("via_budget_exceeded")
  expect(result.rejection.connectionNames).toEqual(["signal_plain"])
})
