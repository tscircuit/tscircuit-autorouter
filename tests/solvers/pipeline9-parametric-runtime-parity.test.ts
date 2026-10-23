import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"

test("certified formula routes retain complete serial/runtime output and native logical iteration parity", async (): Promise<void> => {
  const params = {
    nodePortPoints: Array.from({ length: 13 }, (_, i) => ({ capacityMeshNodeId: `cell${i}`, center: { x: i * 4, y: 0 }, width: 3, height: 3, availableZ: [0], portPoints: [{ connectionName: `signal${i}`, x: i * 4 - 1, y: -0.5, z: 0 }, { connectionName: `signal${i}`, x: i * 4 + 1, y: 0.5, z: 0 }] })),
    enableParametricConstruction: true, connMap: new ConnectivityMap({}), obstacles: [], fixedHdRoutes: [], layerCount: 2, viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 1,
  }
  const baseline = new Pipeline9HighDensitySolver(params)
  baseline.solve()
  expect(baseline.stats.parametricCompiledNodeCount).toBe(13)
  for (const workerCount of [1, 4]) {
    const solver = new Pipeline9HighDensitySolver(params)
    solver.step()
    const runtime = createPipeline9TestRuntime(workerCount)
    try { await solver.solveAsync(runtime) } finally { await runtime.dispose() }
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.routes).toEqual(baseline.routes)
    expect(solver.stats).toEqual(baseline.stats)
    expect(solver.iterations).toBe(baseline.iterations)
  }
})
