import { expect, test } from "bun:test"
import { ContentAddressedRegionCache } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/content-addressed-region-cache"
import { TransactionalCopperStore } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import {
  createHybridSegmentTransaction,
  createHybridUncoupledRoutingTestProblem,
} from "./fixtures"

test("invalidates a cache hit that fails current exact transaction validation", () => {
  const problem = createHybridUncoupledRoutingTestProblem()
  const cache = new ContentAddressedRegionCache({
    maximumEntryCount: 4,
    maximumStoredBytes: 1_000_000,
  })
  const store = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 4,
  })
  const authoritative = createHybridSegmentTransaction({
    problem,
    transactionId: "cache-authoritative",
    connectionName: "bus_0",
    start: { x: -8, y: -0.5 },
    end: { x: -2, y: -0.5 },
  })
  const staleCandidate = createHybridSegmentTransaction({
    problem,
    transactionId: "cache-stale",
    connectionName: "bus_1",
    start: { x: -8, y: -0.7 },
    end: { x: -2, y: -0.7 },
  })
  cache.put({
    key: "stale-key",
    transactionDelta: staleCandidate,
    diagnostic: staleCandidate.diagnostic,
  })
  expect(store.commit(authoritative).status).toBe("committed")

  const cached = cache.get("stale-key")
  expect(cached).toBeDefined()
  if (!cached) return
  const validation = store.validate(cached.transactionDelta)
  expect(validation.status).toBe("rejected")
  expect(cache.invalidate(cached.key)).toBe(true)
  expect(cache.getSnapshot().invalidations).toBe(1)
  expect(cache.get("stale-key")).toBeUndefined()
})
