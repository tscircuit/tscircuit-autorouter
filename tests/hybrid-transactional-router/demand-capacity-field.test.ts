import { expect, test } from "bun:test"
import { DemandCapacityField } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/demand-capacity-field"
import { planGlobalTopology } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/global-topology-planner"
import { TransactionalCopperStore } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import {
  createHybridRoutingTestProblem,
  createHybridSegmentTransaction,
} from "./fixtures"

test("updates only a bounded versioned demand field after a committed delta", () => {
  const problem = createHybridRoutingTestProblem()
  const topologyPlan = planGlobalTopology({
    problem,
    maximumEstimatedMemoryBytesPerObject: 16 * 1024 * 1024,
  })
  const store = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 4,
  })
  const field = new DemandCapacityField({
    problem,
    topologyPlan,
    copperSnapshot: store.getSnapshot(),
    maximumCellCount: 100,
  })
  const delta = createHybridSegmentTransaction({
    problem,
    transactionId: "field-update",
    connectionName: "signal_plain",
    start: { x: -8, y: 2.5 },
    end: { x: 8, y: 2.5 },
  })
  const commit = store.commit(delta)
  expect(commit.status).toBe("committed")
  if (commit.status !== "committed") return

  field.applyCommittedTransaction({
    delta,
    committedSnapshot: commit.snapshot,
  })
  const snapshot = field.getSnapshot()

  expect(snapshot.version).toBe(1)
  expect(snapshot.cells.length).toBeLessThanOrEqual(100)
  expect(
    snapshot.cells.some((cell) => cell.committedCopperDemand > 0),
  ).toBe(true)
})
