import { expect, test } from "bun:test"
import { TransactionalCopperStore } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import {
  createHybridRoutingTestProblem,
  createHybridSegmentTransaction,
} from "./fixtures"

test("commits an exactly validated transaction into a new immutable copper version", () => {
  const problem = createHybridRoutingTestProblem()
  const store = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 4,
  })
  const delta = createHybridSegmentTransaction({
    problem,
    transactionId: "signal-plain-route",
    connectionName: "signal_plain",
    start: { x: -8, y: 2.5 },
    end: { x: 8, y: 2.5 },
    connectedTerminalIds: ["signal_plain_start", "signal_plain_end"],
  })

  const result = store.commit(delta)

  expect(result.status).toBe("committed")
  if (result.status !== "committed") return
  expect(result.snapshot.version).toBe(1)
  expect(result.snapshot.segments.map((segment) => segment.copperId)).toContain(
    "signal-plain-route:segment",
  )
  expect(Object.isFrozen(result.snapshot.segments)).toBe(true)
  expect(store.getCommittedTransactions()).toHaveLength(1)
})
