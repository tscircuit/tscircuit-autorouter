import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { createPipeline9TestRuntime } from "./fixtures/createPipeline9TestRuntime"
import { makeLazyHdSyntheticNode } from "./fixtures/lazyHdSynthetic"

test("actual Pipeline9 factory and source workers preserve omitted/false/true outputs and bounded execution evidence", async () => {
  const outputs: unknown[] = [], iterations: number[] = []
  const node = makeLazyHdSyntheticNode(1)
  for (const flag of [undefined, false, true]) {
    const board = { bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 }, layerCount: 2, minTraceWidth: 0.1, obstacles: [], connections: ["net0", "net1"].map((name) => ({ name, pointsToConnect: node.portPoints.filter((p) => p.connectionName === name).map((p) => ({ x: p.x, y: p.y, layer: p.z === 0 ? "top" : "bottom" })) })) }
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(board, { cacheProvider: null, ...(flag === undefined ? {} : { experimentLazyHdCandidates: flag }) })
    pipeline.srjWithPointPairs = board
    pipeline.portPointPathingSolver = { getOutput: () => ({ nodesWithPortPoints: [node], changedPreloadedTraceSections: [] }), computeNodePfMap: () => new Map() } as unknown as typeof pipeline.portPointPathingSolver
    const factory = pipeline.pipelineDef.find((entry) => entry.solverName === "highDensityRouteSolver")!
    const [params] = factory.getConstructorParams(pipeline) as ConstructorParameters<typeof Pipeline9HighDensitySolver>
    expect(params.experimentLazyHdCandidates).toBe(flag === true ? true : undefined)
    getGlobalInMemoryCache().clearCache()
    const serial = new Pipeline9HighDensitySolver(params)
    serial.solve()
    expect(serial.solved).toBeTrue()
    outputs.push(serial.routes); iterations.push(serial.iterations)
    const counts = serial.lazyHdStats ?? {} as Record<string, number>
    if (flag === true) {
      expect(Object.keys(counts)).toHaveLength(16)
      expect(counts.lazyHdDeferredCandidates).toBeGreaterThan(0)
      expect(counts.lazyHdDeferredCandidates).toBeGreaterThanOrEqual(counts.lazyHdMaterializedCandidates!)
      expect(counts.lazyHdDeferredGridStates).toBeGreaterThanOrEqual(counts.lazyHdMaterializedGridStates!)
    } else {
      expect(counts).toEqual({})
      expect(Object.hasOwn(serial, "lazyHdStats")).toBeFalse()
    }
    const runtime = createPipeline9TestRuntime(1)
    try {
      const worker = new Pipeline9HighDensitySolver(params)
      await worker.solveAsync(runtime)
      expect(worker.solved).toBeTrue()
      expect(worker.routes).toEqual(serial.routes)
      const workerCounts = Object.fromEntries(Object.entries(worker.lazyHdStats ?? {}).filter(([key]) => key !== "lazyHdMaterializationMs"))
      const serialCounts = Object.fromEntries(Object.entries(counts).filter(([key]) => key !== "lazyHdMaterializationMs"))
      expect(workerCounts).toEqual(serialCounts)
    } finally { await runtime.dispose() }
  }
  expect(outputs[1]).toEqual(outputs[0]); expect(outputs[2]).toEqual(outputs[0])
  expect(iterations[1]).toBe(iterations[0]); expect(iterations[2]).toBe(iterations[0])
})
