import { expect, test } from "bun:test"
import { executeFirstValidA13NodeJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeFirstValidA13NodeJob"
import { validateFirstValidHighDensityRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/validateFirstValidHighDensityRoutes"
import type { Pipeline9ParallelHighDensityContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"
import { createFirstValidFrontierFixture } from "tests/fixtures/first-valid-frontier-fixture"

test("stage A13 candidates retain original physical-width factory, root repair and cooperative cancellation", (): void => {
  const { params, nodes } = createFirstValidFrontierFixture(1)
  const context: Pipeline9ParallelHighDensityContext = { ...params,
    connectivityNetMap: params.connMap.netMap, connectivityIdToNetMap: params.connMap.idToNetMap,
    colorMap: {}, allowBlindAndBuriedVias: false, preserveTerminalPcbPortIds: true,
    includeBoardObstacles: true, enableRegionalFallback: true, firstValidClearance: 0.1 }
  const cancellation = new Int32Array(new SharedArrayBuffer(4))
  const result = executeFirstValidA13NodeJob({ kind: "highDensityA13Node", contextId: 1, context,
    nodeWithPortPoints: nodes[0]!, nodePf: 0.5, cancellationBuffer: cancellation.buffer as SharedArrayBuffer })
  expect(result.status).toBe("solved")
  if (result.status !== "solved") throw new Error(`A13 node did not solve: ${JSON.stringify(result)}`)
  expect(result.routes).toHaveLength(2)
  expect(result.routes.map((route) => route.rootConnectionName)).toEqual(["root_0_0", "root_0_1"])
  expect(result.work.maxIterations).toBeGreaterThanOrEqual(50_000_000)
  expect(result.work.routingIterations).toBeGreaterThan(0)
  expect(validateFirstValidHighDensityRoutes({ routes: result.routes, node: nodes[0]!, connMap: params.connMap,
    traceWidth: 0.15, viaDiameter: 0.3, obstacleMargin: 0.1, layerCount: 2, obstacles: [] })).toEqual({ valid: true })
  expect(result.nodeStats.regularNodeCount).toBe(1)
  expect(result.nodeStats.solvedNodeCount).toBe(1)
  cancellation[0] = 1
  const cancelled = executeFirstValidA13NodeJob({ kind: "highDensityA13Node", contextId: 1, context,
    nodeWithPortPoints: nodes[0]!, nodePf: 0.5, cancellationBuffer: cancellation.buffer as SharedArrayBuffer })
  expect(cancelled.status).toBe("cancelled")
  expect(cancelled.work.iterations).toBe(0)
  expect(cancelled.work.routingIterations).toBe(0)
})
