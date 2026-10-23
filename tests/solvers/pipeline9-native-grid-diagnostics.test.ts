import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"

test("native grid counters reach the phase across grow/shrink and worker batches without changing stable stats", async (): Promise<void> => {
  const params: Pipeline9HighDensitySolverParams = {
    nodePortPoints: Array.from({ length: 9 }, (_, index) => ({ capacityMeshNodeId: `diagnostic-${index}`, center: { x: index * 4, y: 0 }, width: 2, height: 2, availableZ: [0], portPoints: [
      { connectionName: `signal-${index}`, rootConnectionName: `signal-${index}`, x: index * 4 - 1, y: 0, z: 0 },
      { connectionName: `signal-${index}`, rootConnectionName: `signal-${index}`, x: index * 4 + 1, y: 0, z: 0 },
    ] })),
    fixedHdRoutes: [], connMap: new ConnectivityMap({}), obstacles: [], layerCount: 2, viaDiameter: 0.3, traceWidth: 0.15, obstacleMargin: 0.15, effort: 1,
  }
  const serial = new Pipeline9HighDensitySolver(params)
  serial.solve()
  const threaded = new Pipeline9HighDensitySolver(params)
  const runtime = createPipeline9TestRuntime(2)
  try {
    await threaded.solveAsync(runtime)
  } finally {
    await runtime.dispose()
  }
  expect(serial.solved).toBe(true)
  expect(threaded.solved).toBe(true)
  expect(threaded.routes).toEqual(serial.routes)
  expect(threaded.stats).toEqual(serial.stats)
  expect(threaded.iterations).toBe(serial.iterations)
  const counters = serial.benchmarkDiagnosticCounters
  expect(counters.nativeGridDeferredCandidateCount).toBe(18)
  expect(counters.nativeGridAvoidedCandidateCount).toBe(18)
  expect(counters.nativeGridMaterializedCandidateCount).toBe(0)
  expect(counters.nativeGridAvoidedPlaneCellCount).toBeGreaterThan(0)
  for (const [key, value] of Object.entries(counters)) {
    if (!key.includes("Batch")) expect(threaded.benchmarkDiagnosticCounters[key]).toBe(value)
    expect(serial.stats[key]).toBeUndefined()
  }
  expect(threaded.benchmarkDiagnosticCounters.nativeGridSubmittedBatchCount).toBe(3)
  expect(threaded.benchmarkDiagnosticCounters.nativeGridCompletedBatchCount).toBe(3)
  expect(threaded.benchmarkDiagnosticCounters.nativeGridPendingBatchCount).toBe(0)
  expect(threaded.benchmarkDiagnosticCounters).toEqual(threaded.benchmarkDiagnosticCounters)
})
