import { expect, test } from "bun:test"
import { TransactionalCopperStore } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import {
  createHybridRoutingTestProblem,
  createHybridSegmentTransaction,
} from "./fixtures"

test("rejects a foreign trace crossing an immutable rotated-pad obstacle", () => {
  const problem = createHybridRoutingTestProblem()
  const store = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 4,
  })
  const delta = createHybridSegmentTransaction({
    problem,
    transactionId: "pad-crossing",
    connectionName: "bus_0",
    start: { x: -2, y: 0 },
    end: { x: 2, y: 0 },
  })

  const result = store.validate(delta)

  expect(result.status).toBe("rejected")
  if (result.status !== "rejected") return
  expect(result.rejection.code).toBe("obstacle_clearance_violation")
  expect(result.drcPredicateCalls).toBe(1)
})
