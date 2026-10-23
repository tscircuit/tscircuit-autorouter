import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"
import { getGlobalInMemoryCache } from "../../lib/cache/setupGlobalCaches"

test("real ordinary-failure refinement preserves complete pipeline output and learned evidence with a runtime", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 1)
  getGlobalInMemoryCache().clearCache()
  const serial = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario), { cacheProvider: null, effort: 1 },
  )
  serial.solve()
  expect(serial.solved, serial.error ?? "").toBe(true)
  expect(serial.detailedRoutingFeedback.stats.detailedFeedbackEarlyReplanCount).toBeGreaterThan(0)
  getGlobalInMemoryCache().clearCache()
  const runtime = createPipeline9TestRuntime(2)
  const asynchronous = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario), { cacheProvider: null, effort: 1 },
  )
  try { await asynchronous.solveAsync(runtime) } finally { await runtime.dispose() }
  expect(asynchronous.solved, asynchronous.error ?? "").toBe(true)
  expect(asynchronous.failed).toBe(false)
  expect(asynchronous.getOutputSimpleRouteJson()).toEqual(serial.getOutputSimpleRouteJson())
  // Native memo caches live separately in worker contexts. Their internal
  // cache hits may change kernel steps; the feedback and physical output must
  // remain identical. The cold tiny fixture checks exact logical work parity.
  expect(asynchronous.detailedRoutingRounds.map(({ detailedIterations, ...round }) => round))
    .toEqual(serial.detailedRoutingRounds.map(({ detailedIterations, ...round }) => round))
  expect(asynchronous.detailedRoutingFeedback.stats).toEqual(serial.detailedRoutingFeedback.stats)
  expect(asynchronous.highDensityRouteSolver!.stats.detailedFeedbackAvoidedRegionalRecoveryCount)
    .toBe(serial.highDensityRouteSolver!.stats.detailedFeedbackAvoidedRegionalRecoveryCount)
  expect(asynchronous.highDensityRouteSolver!.stats.detailedFeedbackTotalRegionalRecoveryCount)
    .toBe(serial.highDensityRouteSolver!.stats.detailedFeedbackTotalRegionalRecoveryCount)
})
