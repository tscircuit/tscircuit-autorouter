import { expect, test } from "bun:test"
import { TransactionalCopperStore } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import {
  createHybridRoutingTestProblem,
  createHybridSegmentTransaction,
} from "./fixtures"

test("rejects copper that violates the compiled board-edge clearance", () => {
  const problem = createHybridRoutingTestProblem()
  const store = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 4,
  })
  const delta = createHybridSegmentTransaction({
    problem,
    transactionId: "edge-violation",
    connectionName: "bus_0",
    start: { x: -9.9, y: -4 },
    end: { x: -8, y: -4 },
  })

  const result = store.validate(delta)

  expect(result.status).toBe("rejected")
  if (result.status !== "rejected") return
  expect(result.rejection.code).toBe("outside_board_outline")
})
