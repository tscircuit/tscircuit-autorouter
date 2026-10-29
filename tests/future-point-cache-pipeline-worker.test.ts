import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { createPipeline9TestRuntime } from "./fixtures/createPipeline9TestRuntime"
import { makeFutureCacheNode } from "./fixtures/futurePointCacheSynthetic"

test("Pipeline9 actual factory and workers forward the experiment and merge actual owned cache work once", async () => {
  const outputs: unknown[] = [], iterations: number[] = []
  const node = makeFutureCacheNode(0)
  for (const flag of [undefined, false, true]) {
    const board = { bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 }, layerCount: 2, minTraceWidth: .1, obstacles: [], connections: Array.from({ length: 5 }, (_, i) => ({ name: `net${i}`, pointsToConnect: node.portPoints.filter((p) => p.connectionName === `net${i}`).map((p) => ({ x: p.x, y: p.y, layer: "top" })) })) }
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(board, { cacheProvider: null, ...(flag === undefined ? {} : { experimentFuturePointCache: flag }) })
    pipeline.srjWithPointPairs = board
    pipeline.portPointPathingSolver = { getOutput: () => ({ nodesWithPortPoints: [node], changedPreloadedTraceSections: [] }), computeNodePfMap: () => new Map() } as unknown as typeof pipeline.portPointPathingSolver
    const factory = pipeline.pipelineDef.find((entry) => entry.solverName === "highDensityRouteSolver")!
    const [params] = factory.getConstructorParams(pipeline) as ConstructorParameters<typeof Pipeline9HighDensitySolver>
    expect(params.experimentFuturePointCache).toBe(flag === true ? true : undefined)
    getGlobalInMemoryCache().clearCache()
    const serial = new Pipeline9HighDensitySolver(params)
    serial.solve()
    expect(serial.solved).toBeTrue()
    outputs.push(serial.routes); iterations.push(serial.iterations)
    if (flag === true) {
      expect(Object.keys(serial.futurePointCacheStats!)).toHaveLength(16)
      expect(Object.keys(serial.futurePointCacheShadowStats!)).toHaveLength(16)
      expect(Object.getOwnPropertyDescriptor(serial, "futurePointCacheShadowStats")!.get).toBeUndefined()
      expect(serial.futurePointCacheShadowStats!.lookups).toBe(serial.futurePointCacheStats!.lookups)
      expect(serial.futurePointCacheShadowStats!.candidateDistanceEvaluations).toBe(serial.futurePointCacheStats!.distanceEvaluations)
      expect(serial.futurePointCacheShadowStats!.indexMismatches).toBe(0)
      expect(Object.getOwnPropertyDescriptor(serial, "futurePointCacheStats")!.get).toBeUndefined()
      expect(serial.futurePointCacheStats!.instances).toBeGreaterThan(0)
      expect(serial.futurePointCacheStats!.mixedHashLookups).toBeGreaterThan(0)
      expect(serial.futurePointCacheStats!.lookups).toBe(serial.futurePointCacheStats!.hits + serial.futurePointCacheStats!.misses)
    } else {
      expect(Object.hasOwn(serial, "futurePointCacheStats")).toBeFalse()
      expect(Object.hasOwn(serial, "futurePointCacheShadowStats")).toBeFalse()
    }
    const runtime = createPipeline9TestRuntime(2)
    try {
      const worker = new Pipeline9HighDensitySolver(params)
      await worker.solveAsync(runtime)
      expect(worker.solved).toBeTrue()
      // Native debug Symbols do not cross structured-clone worker messages.
      expect(worker.routes).toEqual(structuredClone(serial.routes))
      expect(worker.futurePointCacheStats).toEqual(serial.futurePointCacheStats)
      expect(worker.futurePointCacheShadowStats).toEqual(serial.futurePointCacheShadowStats)
    } finally { await runtime.dispose() }
  }
  expect(outputs[1]).toEqual(outputs[0]); expect(outputs[2]).toEqual(outputs[0])
  expect(iterations[1]).toBe(iterations[0]); expect(iterations[2]).toBe(iterations[0])
})
