import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9ParallelHighDensitySolver } from "../../lib/autorouter-pipelines/Pipeline9_Parallel/Pipeline9ParallelHighDensitySolver"
import type { SolverRuntime } from "../../lib/solver-runtime/SolverRuntime"

test("fixed-copper jobs retain the original synchronous repair sequence", () => {
  const params: Pipeline9HighDensitySolverParams = {
    nodePortPoints: [{ capacityMeshNodeId: "node", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1], portPoints: [
      { x: -2, y: 0, z: 0, connectionName: "a" }, { x: 2, y: 0, z: 0, connectionName: "a" },
    ] }],
    fixedHdRoutes: [{ connectionName: "fixed", traceThickness: 0.15, viaDiameter: 0.6, route: [{ x: 10, y: 10, z: 0 }, { x: 11, y: 10, z: 0 }], vias: [], preloadedTraceIndex: 0, preloadedRouteIndex: 0 }],
    connMap: new ConnectivityMap({ a: ["a"], fixed: ["fixed"] }), obstacles: [], layerCount: 2, viaDiameter: 0.6, traceWidth: 0.15, obstacleMargin: 0.15, effort: 1,
  }
  const runtime: SolverRuntime = { runBatch: () => { throw new Error("Dependent nodes must not be dispatched") }, dispose: () => {} }
  const baseline = new Pipeline9HighDensitySolver(params)
  const parallel = new Pipeline9ParallelHighDensitySolver({ ...params, runtime })
  baseline.solve()
  parallel.solve()
  expect(baseline.solved).toBe(true)
  expect(parallel.solved).toBe(true)
  expect(parallel.routes).toEqual(baseline.routes)
  expect(parallel.getUpdatedFixedHdRoutes()).toEqual(baseline.getUpdatedFixedHdRoutes())
  expect(parallel.iterations).toBe(baseline.iterations)
  expect(parallel.stats).toEqual(baseline.stats)
})
