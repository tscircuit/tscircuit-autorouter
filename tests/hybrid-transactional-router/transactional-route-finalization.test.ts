import { expect, test } from "bun:test"
import { finalizeCoupledRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/coupled-route-finalizer"
import { TransactionalCopperStore } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import { createHybridSegmentTransaction, createHybridUncoupledRoutingTestProblem } from "./fixtures"

test("simplifies collinear copper through a newly validated transaction", () => {
  const problem = createHybridUncoupledRoutingTestProblem()
  const store = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 8,
  })
  expect(
    store.commit(
      createHybridSegmentTransaction({
        problem,
        transactionId: "route-left",
        connectionName: "diff_positive",
        start: { x: -8, y: -2.5 },
        end: { x: 0, y: -2.5 },
      }),
    ).status,
  ).toBe("committed")
  expect(
    store.commit(
      createHybridSegmentTransaction({
        problem,
        transactionId: "route-right",
        connectionName: "diff_positive",
        start: { x: 0, y: -2.5 },
        end: { x: 8, y: -2.5 },
        baseCopperVersion: 1,
      }),
    ).status,
  ).toBe("committed")

  const result = finalizeCoupledRoutes({ problem, copperStore: store })

  expect(result.status).toBe("finalized")
  expect(result.records).toHaveLength(1)
  expect(
    store
      .getSnapshot()
      .segments.filter(
        (segment) => segment.connectionName === "diff_positive",
      ),
  ).toHaveLength(1)
  expect(store.getSnapshot().version).toBe(3)
})
