import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"

const params: Pipeline9HighDensitySolverParams = {
  nodePortPoints: [{
    capacityMeshNodeId: "crossing", center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0],
    portPoints: [
      { x: -1, y: 0, z: 0, connectionName: "horizontal" },
      { x: 1, y: 0, z: 0, connectionName: "horizontal" },
      { x: 0, y: -1, z: 0, connectionName: "vertical" },
      { x: 0, y: 1, z: 0, connectionName: "vertical" },
    ],
  }],
  fixedHdRoutes: [], connMap: new ConnectivityMap({}), obstacles: [], layerCount: 1,
  viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 0.02, enableRegionalFallback: false,
}

test("async workers preserve high-density routing failures and release their threads", async (): Promise<void> => {
  const baseline = new Pipeline9HighDensitySolver(params)
  baseline.solve()
  expect(baseline.failed).toBe(true)
  const solver = new Pipeline9HighDensitySolver(params)
  await solver.solveAsync({ workerCount: 2 })
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.error).toBe(baseline.error)
  expect(solver.routes).toEqual(baseline.routes)
  expect(solver.stats).toEqual(baseline.stats)
  expect(solver.iterations).toBe(baseline.iterations)
  expect(solver.unsolvedNodePortPoints).toEqual(baseline.unsolvedNodePortPoints)
})
