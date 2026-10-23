import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"

test("failed detailed-node evidence survives worker transport in serial node order", async (): Promise<void> => {
  const params: Pipeline9HighDensitySolverParams = {
    nodePortPoints: [{
      capacityMeshNodeId: "crossing", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0],
      portPoints: [
        { connectionName: "a", x: -2, y: 0, z: 0 }, { connectionName: "a", x: 2, y: 0, z: 0 },
        { connectionName: "b", x: 0, y: -2, z: 0 }, { connectionName: "b", x: 0, y: 2, z: 0 },
      ],
    }],
    fixedHdRoutes: [], connMap: new ConnectivityMap({}), obstacles: [],
    layerCount: 2, viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 1,
    collectDetailedRoutingFeedback: true,
  }
  const serial = new Pipeline9HighDensitySolver(params)
  serial.solve()
  expect(serial.solved, serial.error ?? "").toBe(true)
  expect(serial.detailedRoutingConflicts).toHaveLength(1)
  expect(serial.detailedRoutingConflicts[0]!.kind).toBe("single-layer-crossing")
  const parallel = new Pipeline9HighDensitySolver(params)
  const runtime = createPipeline9TestRuntime(2)
  try { await parallel.solveAsync(runtime) } finally { await runtime.dispose() }
  expect(parallel.solved, parallel.error ?? "").toBe(true)
  expect(parallel.detailedRoutingConflicts).toEqual(serial.detailedRoutingConflicts)
  expect(parallel.stats).toEqual(serial.stats)
  expect(parallel.routes).toEqual(serial.routes)
  expect(parallel.iterations).toBe(serial.iterations)
})
