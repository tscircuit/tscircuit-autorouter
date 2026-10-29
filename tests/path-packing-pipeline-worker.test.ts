import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { packingCrossingNode } from "./fixtures/pathPackingSynthetic"
import { createPipeline9TestRuntime } from "./fixtures/createPipeline9TestRuntime"

test("actual Pipeline9 factory and workers propagate packing while omitted and false preserve native output", async () => {
  const outputs: unknown[] = [], iterations: number[] = []
  for (const requested of [undefined, false, true]) {
    getGlobalInMemoryCache().clearCache()
    const board = { bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 }, layerCount: 2,
      minTraceWidth: 0.1, minTraceToHoleEdgeClearance: 0.27,
      minViaEdgeToPadEdgeClearance: 0.34, minViaHoleEdgeToViaHoleEdgeClearance: 0.22,
      obstacles: [{ type: "rect" as const, center: { x: 2.8, y: 2.8 }, width: 0.1, height: 0.1,
        layers: ["top"], connectedTo: ["fixed-foreign"] }], connections: ["a", "b"].map((name) => ({ name,
        pointsToConnect: packingCrossingNode.portPoints.filter((p) => p.connectionName === name)
          .map((p) => ({ x: p.x, y: p.y, layer: "top" })) })) }
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(board, { cacheProvider: null,
      ...(requested === undefined ? {} : { experimentPathPacking: requested }) })
    pipeline.srjWithPointPairs = board
    pipeline.portPointPathingSolver = { getOutput: () => ({ nodesWithPortPoints: [packingCrossingNode], changedPreloadedTraceSections: [] }),
      computeNodePfMap: () => new Map() } as unknown as typeof pipeline.portPointPathingSolver
    const stage = pipeline.pipelineDef.find((s) => s.solverName === "highDensityRouteSolver")!
    const [params] = stage.getConstructorParams(pipeline) as ConstructorParameters<typeof Pipeline9HighDensitySolver>
    expect(params.experimentPathPacking).toBe(requested === true ? true : undefined)
    expect(params.obstacles).toBe(pipeline.srj.obstacles)
    expect(params.obstacles).toHaveLength(1)
    expect(params.pathPackingHoleClearance).toBe(requested === true ? 0.27 : undefined)
    expect(params.pathPackingViaToPadClearance).toBe(requested === true ? 0.34 : undefined)
    expect(params.minViaHoleEdgeToViaHoleEdgeClearance).toBe(0.22)
    const solver = new Pipeline9HighDensitySolver(params)
    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    outputs.push(solver.routes); iterations.push(solver.iterations)
    if (requested === true) {
      expect(Object.getOwnPropertyDescriptor(solver, "pathPackingStats")!.get).toBeUndefined()
      expect(solver.pathPackingStats!.requested).toBeTrue()
      expect(solver.pathPackingStats!.instances).toBeGreaterThan(0)
      expect(solver.pathPackingStats!.workUnits).toBeGreaterThan(0)
      expect(Object.keys(solver.pathPackingStats!)).toHaveLength(16)
      expect(Object.hasOwn(solver.benchmarkDiagnosticCounters, "pathPackingPortfolioSelectedNodes")).toBeTrue()
      expect(solver.benchmarkDiagnosticCounters.pathPackingPortfolioSelectedNodes).toBeGreaterThanOrEqual(0)
      const runtime = createPipeline9TestRuntime(1)
      try {
        getGlobalInMemoryCache().clearCache()
        const worker = new Pipeline9HighDensitySolver(params)
        await worker.solveAsync(runtime)
        expect(worker.solved).toBeTrue()
        expect(worker.pathPackingStats!.requested).toBeTrue()
        expect(worker.pathPackingStats!.instances).toBeGreaterThan(0)
        expect(worker.pathPackingStats!.workUnits).toBeGreaterThan(0)
        expect(worker.benchmarkDiagnosticCounters.pathPackingPortfolioSelectedNodes)
          .toBe(solver.benchmarkDiagnosticCounters.pathPackingPortfolioSelectedNodes)
        expect(worker.routes).toEqual(solver.routes)
      } finally { await runtime.dispose() }
    } else {
      expect(solver.pathPackingStats).toBeUndefined()
      expect(Object.hasOwn(solver.benchmarkDiagnosticCounters, "pathPackingPortfolioSelectedNodes")).toBeFalse()
    }
  }
  expect(outputs[1]).toEqual(outputs[0])
  expect(iterations[1]).toBe(iterations[0])
})
