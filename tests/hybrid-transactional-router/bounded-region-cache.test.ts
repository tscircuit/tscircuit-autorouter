import { expect, test } from "bun:test"
import { ContentAddressedRegionCache } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/content-addressed-region-cache"
import {
  createHybridRoutingTestProblem,
  createHybridSegmentTransaction,
} from "./fixtures"

test("bounds regional candidate storage with deterministic LRU eviction", () => {
  const problem = createHybridRoutingTestProblem()
  const cache = new ContentAddressedRegionCache({
    maximumEntryCount: 2,
    maximumStoredBytes: 1_000_000,
  })
  const createDelta = (transactionId: string) =>
    createHybridSegmentTransaction({
      problem,
      transactionId,
      connectionName: "signal_plain",
      start: { x: -8, y: 2.5 },
      end: { x: 8, y: 2.5 },
    })
  const first = createDelta("cache-first")
  const second = createDelta("cache-second")
  const third = createDelta("cache-third")
  expect(
    cache.put({
      key: "key:first",
      transactionDelta: first,
      diagnostic: first.diagnostic,
    }),
  ).toBe(true)
  expect(
    cache.put({
      key: "key:second",
      transactionDelta: second,
      diagnostic: second.diagnostic,
    }),
  ).toBe(true)
  expect(cache.get("key:first")?.transactionDelta.transactionId).toBe(
    "cache-first",
  )
  expect(
    cache.put({
      key: "key:third",
      transactionDelta: third,
      diagnostic: third.diagnostic,
    }),
  ).toBe(true)

  expect(cache.get("key:second")).toBeUndefined()
  expect(cache.get("key:first")).toBeDefined()
  expect(cache.getSnapshot()).toMatchObject({
    entryCount: 2,
    evictions: 1,
  })
  expect(cache.getSnapshot().storedBytes).toBeLessThanOrEqual(1_000_000)
})
