import { expect, test } from "bun:test"
import { createPipeline9ReferenceCacheFixture } from "../fixtures/createPipeline9ReferenceCacheFixture"

test("connectivity changes invalidate retained and consecutive reference results", (): void => {
  const { solver, reference, routes } = createPipeline9ReferenceCacheFixture()
  const input = { traces: [], routes }
  const original = reference(input)
  expect(reference(input)).toBe(original)
  solver.params.connMap.addConnections([["signal", "signal_regional_0"]])
  const after = reference(input)
  expect(after).toEqual(original)
  expect(after).not.toBe(original)
  expect(solver.stats.referenceDrcCacheContextInvalidationCount).toBe(1)
  expect(solver.stats.referenceDrcCacheMissCount).toBe(2)
  expect(solver.stats.referenceDrcCacheSize).toBe(1)
})
