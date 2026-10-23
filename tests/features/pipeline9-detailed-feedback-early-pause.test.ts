import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"

test("ordinary failures form one batch before regional recovery and resume the same native instance with runtime parity", async (): Promise<void> => {
  const params: Pipeline9HighDensitySolverParams = {
    nodePortPoints: [
      {
        capacityMeshNodeId: "crossing-two", center: { x: -8, y: 0 }, width: 4, height: 4, availableZ: [0],
        portPoints: [
          { connectionName: "d", x: -10, y: 0, z: 0 }, { connectionName: "d", x: -6, y: 0, z: 0 },
          { connectionName: "e", x: -8, y: -2, z: 0 }, { connectionName: "e", x: -8, y: 2, z: 0 },
        ],
      },
      {
        capacityMeshNodeId: "unvisited", center: { x: 8, y: 0 }, width: 4, height: 4, availableZ: [0, 1],
        portPoints: [{ connectionName: "c", x: 6, y: 0, z: 0 }, { connectionName: "c", x: 10, y: 0, z: 0 }],
      },
      {
        capacityMeshNodeId: "crossing", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0],
        portPoints: [
          { connectionName: "a", x: -2, y: 0, z: 0 }, { connectionName: "a", x: 2, y: 0, z: 0 },
          { connectionName: "b", x: 0, y: -2, z: 0 }, { connectionName: "b", x: 0, y: 2, z: 0 },
        ],
      },
    ],
    fixedHdRoutes: [], connMap: new ConnectivityMap({}), obstacles: [],
    layerCount: 2, viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 1,
    collectDetailedRoutingFeedback: true, pauseForUpstreamRefinement: true,
  }
  const serial = new Pipeline9HighDensitySolver(params)
  await serial.solveAsync()
  expect(serial.solved).toBe(false)
  expect(serial.failed).toBe(false)
  expect(serial.refinementState.status).toBe("awaiting-upstream-refinement")
  expect(serial.stats.fallbackNodeCount).toBe(0)
  expect(serial.unsolvedNodePortPoints).toEqual([])
  expect(serial.detailedRoutingConflicts).toHaveLength(2)
  expect(serial.routes.map((route) => route.connectionName)).toEqual(["c"])
  expect(serial.stats.regularNodeCount).toBe(3)
  expect(serial.stats.detailedFeedbackPendingRegionalRecoveryCount).toBe(2)
  expect(serial.stats.detailedFeedbackHostRefinementEnabled).toBe(1)
  const worker = new Pipeline9HighDensitySolver(params)
  const runtime = createPipeline9TestRuntime(2)
  try {
    await worker.solveAsync(runtime)
    expect(worker.solved).toBe(false)
    expect(worker.failed).toBe(false)
    expect(worker.refinementState).toEqual(serial.refinementState)
    expect(worker.detailedRoutingConflicts).toEqual(serial.detailedRoutingConflicts)
    expect(worker.stats).toEqual(serial.stats)
    expect(worker.iterations).toBe(serial.iterations)
    expect(worker.unsolvedNodePortPoints).toEqual(serial.unsolvedNodePortPoints)
    serial.resumeDetailedRoutingAfterRefinement()
    worker.resumeDetailedRoutingAfterRefinement()
    await serial.solveAsync()
    await worker.solveAsync(runtime)
    expect(serial.solved, serial.error ?? "").toBe(true)
    expect(worker.solved, worker.error ?? "").toBe(true)
    expect(worker.routes).toEqual(serial.routes)
    expect(worker.stats).toEqual(serial.stats)
    expect(worker.iterations).toBe(serial.iterations)
    expect(serial.stats.regularNodeCount).toBe(3)
    expect(serial.stats.fallbackNodeCount).toBe(2)
    expect(serial.stats.detailedFeedbackPendingRegionalRecoveryCount).toBe(0)
  } finally { await runtime.dispose() }
})
