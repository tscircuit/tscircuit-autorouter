import { expect, test } from "bun:test"
import { Pipeline9ReferenceDrcCache } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ReferenceDrcCache"

test("reference cache bounds retained key characters and skips oversized keys", (): void => {
  const cache = new Pipeline9ReferenceDrcCache(64, 8)
  const result = { errors: [], errorsWithCenters: [] }
  cache.set("one", result)
  cache.set("two", result)
  cache.set("sixsix", result)
  expect(cache.get("one")).toBeUndefined()
  expect(cache.get("two")).toBeUndefined()
  expect(cache.get("sixsix")).toBe(result)
  cache.set("oversized", result)
  expect(cache.get("oversized")).toBe(result)
  expect(cache.get("sixsix")).toBe(result)
  expect(cache.get("oversized")).toBeUndefined()
  cache.set("sixsix", result)
  expect(cache.getStats().referenceDrcCacheKeyCharacters).toBe(6)
  expect(cache.getStats().referenceDrcCacheSize).toBe(1)
  expect(cache.getStats().referenceDrcCacheEvictionCount).toBe(2)
  expect(cache.getStats().referenceDrcCacheOversizedSkipCount).toBe(1)
})
