import { expect, test } from "bun:test"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"

test("runtime errors reject without publishing routes and concurrent async solves are rejected", async (): Promise<void> => {
  const params: Pipeline9HighDensitySolverParams = {
    nodePortPoints: [{capacityMeshNodeId: "node", center: {x: 0, y: 0}, width: 2, height: 2, availableZ: [0], portPoints: [
      {x: -1, y: 0, z: 0, connectionName: "signal"}, {x: 1, y: 0, z: 0, connectionName: "signal"},
    ]}],
    fixedHdRoutes: [], connMap: new ConnectivityMap({}), obstacles: [], layerCount: 2,
    viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 0.1,
  }
  const solver = new Pipeline9HighDensitySolver(params)
  let rejectTask: (error: Error) => void = (): void => { throw new Error("Task was not submitted") }
  const pending = solver.solveAsync({
    executeAsync: () => new Promise((_resolve, reject) => { rejectTask = reject }),
  }).then(() => undefined, (error: unknown) => error)
  const concurrent = await solver.solveAsync().then(() => undefined, (error: unknown) => error)
  expect(String(concurrent)).toContain("already running")
  rejectTask(new Error("worker unavailable"))
  expect(String(await pending)).toContain("worker unavailable")
  expect(solver.failed).toBe(true)
  expect(solver.routes).toEqual([])
  expect(solver.unsolvedNodePortPoints).toHaveLength(1)
})
