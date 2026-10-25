import { expect, test } from "bun:test"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensityBatchSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { priorityParams } from "../solvers/priorityDagTestUtils"

test("activating reverse fields have identical node-local reuse, routes and work ledgers in serial and batched execution", () => {
  const fixture = priorityParams()
  const nodes = Array.from({ length: 3 }, (_, index) => ({
    ...fixture.nodeWithPortPoints,
    capacityMeshNodeId: `reverse-node-${index}`,
    center: { x: index * 10, y: 0 },
    portPoints: fixture.nodeWithPortPoints.portPoints.map((point) => ({
      ...point, x: point.x + index * 10,
      connectionName: `${index}-${point.connectionName}`,
      rootConnectionName: `${index}-${point.rootConnectionName}`,
    })),
  }))
  const params: Pipeline9HighDensitySolverParams = {
    ...fixture, nodePortPoints: nodes, fixedHdRoutes: [],
    connMap: new ConnectivityMap({}), obstacles: [], layerCount: 2,
    viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.1, effort: 1,
  }
  getGlobalInMemoryCache().clearCache()
  const serial = new Pipeline9HighDensitySolver(params)
  serial.solve()
  expect(serial.solved).toBe(true)
  expect(serial.benchmarkDiagnosticCounters.reversePotentialQueries).toBeGreaterThan(0)
  expect(serial.benchmarkDiagnosticCounters.reversePotentialBuilds).toBeGreaterThan(0)
  const { connMap, ...workerParams } = params
  getGlobalInMemoryCache().clearCache()
  const batch = new Pipeline9HighDensityBatchSolver({
    ...workerParams, connectivityNetMap: connMap.netMap,
    maxIterations: serial.MAX_ITERATIONS,
    nodePortPoints: nodes.toReversed(),
  })
  batch.solve()
  const results = batch.getOutput()
  expect(results.every((result) => result.solved)).toBe(true)
  expect(results.flatMap((result) => result.routes)).toEqual(serial.routes)
  const counters: Record<string, number> = {}
  for (const result of results) {
    for (const [key, value] of Object.entries(result.benchmarkDiagnosticCounters))
      counters[key] = (counters[key] ?? 0) + value
  }
  expect(counters).toEqual(serial.benchmarkDiagnosticCounters)
})
