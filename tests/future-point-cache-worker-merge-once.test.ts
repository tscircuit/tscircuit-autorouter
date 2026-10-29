import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { createFuturePointCacheStats, getFuturePointCacheShadowStats } from "lib/solvers/HighDensitySolver/futurePointCacheContext"
import { makeFutureCacheNode } from "./fixtures/futurePointCacheSynthetic"

test("multi-node promises merge completed execution once even when only a serial prefix is accepted", async () => {
  const nodes = Array.from({ length: 17 }, (_, seed) => {
    const node = makeFutureCacheNode(seed)
    node.width += seed * .03; node.height += seed * .04
    for (const point of node.portPoints) { point.x *= node.width / 4; point.y *= node.height / 4 }
    return node
  })
  const workerTotal = createFuturePointCacheStats()
  const shadowTotal = getFuturePointCacheShadowStats(workerTotal)
  let jobs = 0, completedNodes = 0, largestBatch = 0
  const runtime = { executeAsync: async (Solver: any, input: any) => {
    jobs++; largestBatch = Math.max(largestBatch, input.nodePortPoints.length)
    const previous = globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE
    globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE = new InMemoryCache()
    try {
      const child = new Solver(input)
      child.solve()
      const output = child.getOutput()
      for (const result of output) {
        completedNodes++
        if (result.futurePointCacheShadowStats) for (const key of Object.keys(shadowTotal) as (keyof typeof shadowTotal)[]) shadowTotal[key] += result.futurePointCacheShadowStats[key]
        if (result.futurePointCacheStats) for (const key of Object.keys(workerTotal) as (keyof typeof workerTotal)[]) workerTotal[key] += result.futurePointCacheStats[key]
      }
      return output
    } finally { globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE = previous }
  } }
  const serial = new Pipeline9HighDensitySolver({ nodePortPoints: nodes, fixedHdRoutes: [], connMap: new ConnectivityMap({}), obstacles: [], layerCount: 2, viaDiameter: .25, viaHoleDiameter: .1, minViaHoleEdgeToViaHoleEdgeClearance: .1, traceWidth: .1, obstacleMargin: .1, effort: 1, experimentFuturePointCache: true })
  const threaded = new Pipeline9HighDensitySolver({ nodePortPoints: nodes, fixedHdRoutes: [], connMap: new ConnectivityMap({}), obstacles: [], layerCount: 2, viaDiameter: .25, viaHoleDiameter: .1, minViaHoleEdgeToViaHoleEdgeClearance: .1, traceWidth: .1, obstacleMargin: .1, effort: 1, experimentFuturePointCache: true })
  await serial.solveAsync(undefined, 3)
  await threaded.solveAsync(runtime as any, 3)
  expect(jobs).toBe(16); expect(completedNodes).toBe(17); expect(largestBatch).toBe(2)
  expect(threaded.routes).toEqual(serial.routes)
  expect(threaded.iterations).toBe(serial.iterations)
  expect(threaded.solved).toBe(serial.solved)
  const expected = createFuturePointCacheStats()
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) expected[key] = workerTotal[key] + serial.futurePointCacheStats![key]
  expect(threaded.futurePointCacheStats).toEqual(expected)
  const expectedShadow = getFuturePointCacheShadowStats(expected)
  for (const key of Object.keys(expectedShadow) as (keyof typeof expectedShadow)[]) expectedShadow[key] = shadowTotal[key] + serial.futurePointCacheShadowStats![key]
  expect(threaded.futurePointCacheShadowStats).toEqual(expectedShadow)
  expect(threaded.futurePointCacheShadowStats!.lookups).toBeGreaterThan(serial.futurePointCacheShadowStats!.lookups)
  expect(workerTotal.lookups).toBeGreaterThan(0)
  expect(threaded.futurePointCacheStats!.lookups).toBeGreaterThan(serial.futurePointCacheStats!.lookups)
})
