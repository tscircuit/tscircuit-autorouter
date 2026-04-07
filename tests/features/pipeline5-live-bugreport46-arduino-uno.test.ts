import { expect, test } from "bun:test"
import type { Pipeline5HdCacheHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/Pipeline5HdCacheHighDensitySolver"
import { AutoroutingPipelineSolver5 } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/AutoroutingPipelineSolver5_HdCache"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport46-ac4337/bugreport46-ac4337-arduino-uno.json" with {
  type: "json",
}

test.skip(
  "pipeline5 solves the Arduino Uno bugreport with live hd-cache",
  async () => {
    const srj = bugReport.simple_route_json as SimpleRouteJson

    const solver = new AutoroutingPipelineSolver5(structuredClone(srj))
    await solver.solveAsync()

    const highDensitySolver = solver.highDensityRouteSolver as
      | Pipeline5HdCacheHighDensitySolver
      | undefined
    const traces = solver.getOutputSimpleRouteJson().traces ?? []

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.timeToSolve).toBeLessThan(300_000)
    expect(traces.length).toBeGreaterThan(0)
    expect(highDensitySolver).toBeDefined()
    expect(highDensitySolver?.pendingEffects?.length ?? 0).toBe(0)
    expect(highDensitySolver?.stats.remoteRequestsStarted).toBeGreaterThan(0)
    expect(highDensitySolver?.stats.remoteRequestsCompleted).toBe(
      highDensitySolver?.stats.remoteRequestsStarted,
    )
    expect(highDensitySolver?.stats.remoteResponseSampleCount).toBe(
      highDensitySolver?.stats.remoteRequestsStarted,
    )
    expect(highDensitySolver?.stats.slowestRemoteResponseMs).toBeGreaterThan(0)
    expect(highDensitySolver?.stats.p50RemoteResponseMs).toBeGreaterThan(0)
    expect(highDensitySolver?.nodeSolveMetadataById.size).toBe(
      solver.highDensityNodePortPoints?.length ?? 0,
    )
  },
  { timeout: 300_000 },
)
