import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("the public Pipeline9 opt-in reaches the high-density constructor before routing", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.1, obstacles: [],
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [{ name: "signal", pointsToConnect: [
      { x: -3, y: 0, layer: "top" }, { x: 3, y: 0, layer: "top" },
    ] }],
  }
  for (const enabled of [false, true]) {
    const solver = new Pipeline9(structuredClone(input), {
      cacheProvider: null, effort: 1, experimentSearchState: enabled,
    })
    for (let i = 0; i < 10_000 && !solver.failed && solver.getCurrentPhase() !== "highDensityRouteSolver"; i++) solver.step()
    expect(solver.failed).toBe(false)
    expect(solver.getCurrentPhase()).toBe("highDensityRouteSolver")
    solver.step()
    const hd = solver.highDensityRouteSolver!
    expect(hd.iterations).toBe(0)
    expect(hd.stats.searchStateEnabled).toBe(enabled ? 1 : undefined)
    if (enabled) {
      expect(hd.benchmarkDiagnosticCounters.searchStateEnabledHighDensityStages).toBe(1)
    } else {
      expect(hd.benchmarkDiagnosticCounters.searchStateEnabledHighDensityStages).toBeUndefined()
    }
  }
})
