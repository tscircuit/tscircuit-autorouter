import { expect, test } from "bun:test"
import { createBlockerReplacementDelta } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/bounded-blocker-reroute"
import { TransactionalCopperStore } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import {
  createHybridSegmentTransaction,
  createHybridUncoupledRoutingTestProblem,
} from "./fixtures"

test("replaces a committed blocker through one exact atomic transaction", () => {
  const problem = createHybridUncoupledRoutingTestProblem()
  const store = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 8,
  })
  const first = createHybridSegmentTransaction({
    problem,
    transactionId: "initial-blocker",
    connectionName: "diff_positive",
    start: { x: -8, y: -2.5 },
    end: { x: 8, y: -2.5 },
  })
  expect(store.commit(first).status).toBe("committed")
  const candidate = createHybridSegmentTransaction({
    problem,
    transactionId: "rerouted-blocker",
    connectionName: "diff_positive",
    start: { x: -8, y: -2.5 },
    end: { x: 8, y: -2.5 },
    baseCopperVersion: 2,
  })
  const replacement = createBlockerReplacementDelta({
    candidateDelta: candidate,
    authoritativeCopperVersion: 1,
    removedTraceIds: [first.addedTraces[0]!.copperId],
    removedViaIds: [],
    recoveryIndex: 1,
    failedRouteObjectId: "signal:reserved-route",
  })

  expect(replacement.baseCopperVersion).toBe(1)
  expect(replacement.removedOwnedTraceIds).toEqual([
    first.addedTraces[0]!.copperId,
  ])
  expect(store.commit(replacement).status).toBe("committed")
  expect(store.getSnapshot().version).toBe(2)
  const copperIds = store
    .getSnapshot()
    .segments.map((segment) => segment.copperId)
  expect(copperIds).toContain(candidate.addedTraces[0]!.copperId)
  expect(copperIds).not.toContain(first.addedTraces[0]!.copperId)
})
