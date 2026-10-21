import { expect, test } from "bun:test"
import { Pipeline9ReferenceDrcCache } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ReferenceDrcCache"

test("oversized JSON keys retain the original consecutive-reference cache", (): void => {
  const cache = new Pipeline9ReferenceDrcCache(64, 4)
  const result = { errors: [], errorsWithCenters: [] }
  cache.set("too-large", result)
  expect(cache.get("too-large")).toBe(result)
  expect(cache.get("too-large")).toBe(result)
  const stats = cache.getStats()
  expect(stats.referenceDrcCacheSize).toBe(0)
  expect(stats.referenceDrcCacheKeyCharacters).toBe(0)
  expect(stats.referenceDrcCacheLastKeyCharacters).toBe(9)
  expect(stats.referenceDrcCacheConsecutiveHitCount).toBe(2)
  expect(stats.referenceDrcCacheNonconsecutiveHitCount).toBe(0)
})
