import { expect, test } from "bun:test"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9HighDensityBatchSolver, type Pipeline9HighDensityBatchInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"

test("completed worker work is retained once even when every batch crosses the accepted serial budget", async () => {
  let dispatched = 0
  const runtime = { executeAsync: async (_Solver: unknown, input: Pipeline9HighDensityBatchInput): Promise<ReturnType<Pipeline9HighDensityBatchSolver["getOutput"]>> => {
    dispatched++
    const batch = new Pipeline9HighDensityBatchSolver(input)
    batch.solve()
    const result = batch.getOutput()
    // A distinct synthetic ledger marker tests transport; actual routing and
    // original serial replay policy above are exercised without a worker pool.
    result.benchmarkDiagnosticCounters.lazyTransportMarker = 17
    return result
  } } as unknown as SolverRuntimeExecutor
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: Array.from({ length: 9 }, (_, i) => ({ capacityMeshNodeId: `n${i}`,
      center: { x: 4 * i, y: 0 }, width: 2, height: 2, availableZ: [0],
      portPoints: [{ x: 4 * i - 1, y: 0, z: 0, connectionName: `c${i}` },
        { x: 4 * i + 1, y: 0, z: 0, connectionName: `c${i}` }] })),
    fixedHdRoutes: [], connMap: new ConnectivityMap({}), obstacles: [], layerCount: 2,
    viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 0.1,
  })
  solver.MAX_ITERATIONS = 1
  await solver.solveAsync(runtime)
  expect(dispatched).toBe(3)
  expect(solver.benchmarkDiagnosticCounters.lazyWorkerBatchesDispatched).toBe(3)
  expect(solver.benchmarkDiagnosticCounters.lazyWorkerBatchesCompleted).toBe(3)
  expect(solver.benchmarkDiagnosticCounters.lazyWorkerBatchesAccepted ?? 0).toBe(0)
  expect(solver.benchmarkDiagnosticCounters.lazyTransportMarker).toBe(51)
  expect(solver.stats.lazyTransportMarker).toBeUndefined()
  expect(solver.failed).toBe(true)
  expect(solver.routes).toHaveLength(0)
})
