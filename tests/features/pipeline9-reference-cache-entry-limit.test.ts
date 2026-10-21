import { expect, test } from "bun:test"
import { Pipeline9ReferenceDrcCache } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ReferenceDrcCache"

test("reference cache evicts the least recently used entry at its entry limit", (): void => {
  const cache = new Pipeline9ReferenceDrcCache(2)
  const result = { errors: [], errorsWithCenters: [] }
  cache.set("first", result)
  cache.set("second", result)
  expect(cache.get("first")).toBe(result)
  cache.set("third", result)
  expect(cache.get("second")).toBeUndefined()
  expect(cache.get("first")).toBe(result)
  expect(cache.get("third")).toBe(result)
  expect(cache.getStats().referenceDrcCacheEvictionCount).toBe(1)
  expect(cache.getStats().referenceDrcCacheSize).toBe(2)
  expect(cache.getStats().referenceDrcCacheKeyCharacters).toBe(10)
})
