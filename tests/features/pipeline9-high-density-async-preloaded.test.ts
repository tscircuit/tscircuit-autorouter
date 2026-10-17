import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"

const params: Pipeline9HighDensitySolverParams = {
  nodePortPoints: [{
    capacityMeshNodeId: "preloaded-node", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1],
    portPoints: [
      { x: -2, y: 0, z: 0, connectionName: "new-route" },
      { x: 2, y: 0, z: 0, connectionName: "new-route" },
    ],
  }],
  fixedHdRoutes: [{
    connectionName: "fixed-route", rootConnectionName: "fixed-route", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -2, y: -1, z: 0 }, { x: 2, y: -1, z: 0 }], vias: [], preloadedTraceIndex: 0, preloadedRouteIndex: 0,
  }],
  connMap: new ConnectivityMap({}), obstacles: [], layerCount: 2, viaDiameter: 0.3,
  traceWidth: 0.1, obstacleMargin: 0.15, effort: 0.1,
}

test("async solving retains ordered preloaded-copper routing and mutation metadata", async (): Promise<void> => {
  const baseline = new Pipeline9HighDensitySolver(params)
  baseline.solve()
  expect(baseline.solved).toBe(true)
  const solver = new Pipeline9HighDensitySolver(params)
  await solver.solveAsync({ workerCount: 4 })
  expect(solver.solved).toBe(true)
  expect(solver.routes).toEqual(baseline.routes)
  expect(solver.getUpdatedFixedHdRoutes()).toEqual(baseline.getUpdatedFixedHdRoutes())
  expect(solver.preloadedTraceMutationMasks).toEqual(baseline.preloadedTraceMutationMasks)
  expect(solver.stats).toEqual(baseline.stats)
  expect(solver.iterations).toBe(baseline.iterations)
})
