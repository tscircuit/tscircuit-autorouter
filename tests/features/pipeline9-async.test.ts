import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../../lib/types/srj-types"

const input: SimpleRouteJson = {
  layerCount: 2, minTraceWidth: 0.1, obstacles: [],
  bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
  connections: [
    { name: "signal-a", pointsToConnect: [{ x: -3, y: -1, layer: "top" }, { x: 3, y: -1, layer: "top" }] },
    { name: "signal-b", pointsToConnect: [{ x: -3, y: 1, layer: "top" }, { x: 3, y: 1, layer: "top" }] },
  ],
}

test("Pipeline9 solveAsync resumes synchronous steps and preserves complete output and logical iterations", async (): Promise<void> => {
  const baseline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(input), { effort: 0.1, cacheProvider: null })
  baseline.solve()
  expect(baseline.solved).toBe(true)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(input), { effort: 0.1, cacheProvider: null })
  solver.solveUntilPhase("highDensityRouteSolver")
  solver.step()
  solver.step()
  const runtime = createPipeline9TestRuntime(2)
  try { await solver.solveAsync(runtime) } finally { await runtime.dispose() }
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(JSON.stringify(solver.getOutputSimpleRouteJson())).toBe(JSON.stringify(baseline.getOutputSimpleRouteJson()))
  expect(solver.highDensityRouteSolver!.stats).toEqual(baseline.highDensityRouteSolver!.stats)
  expect(solver.iterations).toBe(baseline.iterations)
  expect(solver.progress).toBe(1)
})
