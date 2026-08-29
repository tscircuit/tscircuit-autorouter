import { expect, test } from "bun:test"
import { TransactionalCopperStore } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import {
  createHybridRoutingTestProblem,
  createHybridViaTransaction,
} from "./fixtures"

test("rejects a via whose layer span is not in the compiled legal span set", () => {
  const problem = createHybridRoutingTestProblem()
  const store = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 4,
  })
  const delta = createHybridViaTransaction({
    problem,
    transactionId: "illegal-via-span",
    connectionName: "signal_plain",
    points: [{ x: -4, y: -2 }],
    fromLayer: "top",
    toLayer: "inner2",
  })

  const result = store.validate(delta)

  expect(result.status).toBe("rejected")
  if (result.status !== "rejected") return
  expect(result.rejection.code).toBe("illegal_via_span")
})
