import { expect, test } from "bun:test"
import { createMultiBlockerReplacementDelta } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/bounded-blocker-reroute"
import { TransactionalCopperStore } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import {
  createHybridSegmentTransaction,
  createHybridUncoupledRoutingTestProblem,
} from "./fixtures"

test("atomically replaces copper owned by two explicitly authorized blockers", () => {
  const problem = createHybridUncoupledRoutingTestProblem()
  const store = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 8,
  })
  const firstInitial = createHybridSegmentTransaction({
    problem,
    transactionId: "first-initial",
    connectionName: "diff_positive",
    start: { x: -8, y: -2.5 },
    end: { x: 8, y: -2.5 },
  })
  const secondInitial = createHybridSegmentTransaction({
    problem,
    transactionId: "second-initial",
    connectionName: "diff_negative",
    start: { x: -8, y: 2.5 },
    end: { x: 8, y: 2.5 },
    baseCopperVersion: 1,
  })
  expect(store.commit(firstInitial).status).toBe("committed")
  expect(store.commit(secondInitial).status).toBe("committed")
  const firstCandidate = createHybridSegmentTransaction({
    problem,
    transactionId: "first-candidate",
    connectionName: "diff_positive",
    start: { x: -8, y: -2.5 },
    end: { x: 8, y: -2.5 },
    baseCopperVersion: 3,
  })
  const secondCandidate = createHybridSegmentTransaction({
    problem,
    transactionId: "second-candidate",
    connectionName: "diff_negative",
    start: { x: -8, y: 2.5 },
    end: { x: 8, y: 2.5 },
    baseCopperVersion: 4,
  })
  const replacement = createMultiBlockerReplacementDelta({
    candidateDeltas: [firstCandidate, secondCandidate],
    authoritativeCopperVersion: 2,
    removedTraceIds: [
      firstInitial.addedTraces[0]!.copperId,
      secondInitial.addedTraces[0]!.copperId,
    ],
    removedViaIds: [],
    recoveryIndex: 3,
    failedRouteObjectId: "signal:reserved-route",
  })

  expect(replacement.additionalOwnerRouteObjectIds).toEqual([
    secondCandidate.ownerRouteObjectId,
  ])
  expect(store.commit(replacement).status).toBe("committed")
  expect(store.getSnapshot().version).toBe(3)
  const copperIds = store
    .getSnapshot()
    .segments.map((segment) => segment.copperId)
  expect(copperIds).toContain(firstCandidate.addedTraces[0]!.copperId)
  expect(copperIds).toContain(secondCandidate.addedTraces[0]!.copperId)
  expect(copperIds).not.toContain(firstInitial.addedTraces[0]!.copperId)
  expect(copperIds).not.toContain(secondInitial.addedTraces[0]!.copperId)
})
