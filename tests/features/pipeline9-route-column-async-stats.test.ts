import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"

test("async batches preserve new column counters across multiple activated graph candidates", async () => {
  const params: Pipeline9HighDensitySolverParams = {
    nodePortPoints: Array.from({ length: 5 }, (_, i) => ({
      capacityMeshNodeId: `cross-${i}`, center: { x: i * 8, y: 0 }, width: 6, height: 6, availableZ: [0, 1],
      portPoints: [
        { connectionName: `a-${i}`, x: i * 8 - 3, y: 0, z: 0 }, { connectionName: `a-${i}`, x: i * 8 + 3, y: 0, z: 0 },
        { connectionName: `b-${i}`, x: i * 8, y: -3, z: 0 }, { connectionName: `b-${i}`, x: i * 8, y: 3, z: 0 },
        { connectionName: `c-${i}`, x: i * 8 - 3, y: -3, z: 0 }, { connectionName: `c-${i}`, x: i * 8 + 3, y: 3, z: 0 },
      ],
    })),
    fixedHdRoutes: [], connMap: new ConnectivityMap({}), obstacles: [], layerCount: 2,
    viaDiameter: 0.3, traceWidth: 0.15, obstacleMargin: 0.1, effort: 1,
  }
  const serial = new Pipeline9HighDensitySolver(params)
  serial.solve()
  const parallel = new Pipeline9HighDensitySolver(params)
  const runtime = createPipeline9TestRuntime(2)
  try {
    await parallel.solveAsync(runtime)
  } finally {
    await runtime.dispose()
  }
  expect(parallel.solved).toBe(true)
  expect(parallel.stats).toEqual(serial.stats)
  expect(JSON.stringify(parallel.routes)).toBe(JSON.stringify(serial.routes))
  expect(parallel.stats.routeColumnCandidateCount).toBe(5)
  expect(parallel.stats.routeColumnCopperGeometryCheckCount).toBeGreaterThan(0)
  for (const [key, value] of Object.entries(parallel.stats)) {
    if (key.startsWith("routeColumn")) expect(Number.isFinite(value)).toBe(true)
  }
})
