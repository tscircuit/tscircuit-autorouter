import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createAutorouterSolverRuntime as createBunRuntime } from "../../lib/runtime/bun"
import { createAutorouterSolverRuntime as createNodeRuntime } from "../../lib/runtime/node"
import type { SimpleRouteJson } from "../../lib/types/srj-types"

const input: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1, obstacles: [], bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 }, connections: [
  { name: "signal-a", pointsToConnect: [{ x: -3, y: -1, layer: "top" }, { x: 3, y: -1, layer: "top" }] },
  { name: "signal-b", pointsToConnect: [{ x: -3, y: 1, layer: "top" }, { x: 3, y: 1, layer: "top" }] },
] }

test("parallel port-point routing works with bundled Bun and Node workers and releases them for later stages", async (): Promise<void> => {
  const baseline = new Pipeline9(structuredClone(input), { effort: 0.1, cacheProvider: null }); baseline.solve()
  expect(baseline.solved).toBe(true)
  for (const createRuntime of [createBunRuntime, createNodeRuntime]) {
    const solver = new Pipeline9(structuredClone(input), { effort: 0.1, cacheProvider: null })
    const runtime = createRuntime({ workerCount: 4, requireWorker: true })
    expect(runtime.persistentWorkerCount).toBe(4)
    try { await solver.solveAsync(runtime) } finally { await runtime.dispose() }
    expect(solver.failed).toBe(false); expect(solver.solved).toBe(true)
    expect(solver.getOutputSimpleRouteJson()).toEqual(baseline.getOutputSimpleRouteJson())
    expect(solver.iterations).toBe(baseline.iterations)
    const metrics = solver.portPointPathingSolver!.getSolveGraphBenchmarkMetrics()!
    expect(metrics.wasmRouteSearches).toBeGreaterThan(0)
    expect(metrics.parallelRouteWorkers).toBe(3)
  }
})
