import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { searchStateFactoryNode } from "./searchStateTestUtils"

test("Pipeline9 regular-node and priority factories propagate the opt-in to low-level searches", (): void => {
  for (const enabled of [false, true]) {
    const solver = new Pipeline9HighDensitySolver({
      nodePortPoints: [searchStateFactoryNode()], fixedHdRoutes: [],
      connMap: new ConnectivityMap({}), obstacles: [], layerCount: 2,
      viaDiameter: 0.3, viaHoleDiameter: 0.15, traceWidth: 0.1,
      obstacleMargin: 0.1, effort: 1, experimentSearchState: enabled,
    })
    solver.step()
    expect(solver.activeRegularSolver!.experimentSearchState).toBe(enabled)
    for (let i = 0; i < 1000 && !solver.solved && !solver.failed; i++) {
      solver.step()
      if (solver.benchmarkDiagnosticCounters.searchStateLowLevelInstances) break
    }
    if (enabled) {
      expect(solver.stats.searchStateEnabled).toBe(1)
      expect(solver.benchmarkDiagnosticCounters.searchStateEnabledRegularNodes).toBe(1)
      expect(solver.benchmarkDiagnosticCounters.searchStateLowLevelInstances).toBeGreaterThan(0)
    } else {
      expect(Object.keys(solver.benchmarkDiagnosticCounters).some((key) => key.startsWith("searchState"))).toBe(false)
    }
  }
})
