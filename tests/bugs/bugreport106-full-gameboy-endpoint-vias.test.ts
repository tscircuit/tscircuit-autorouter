import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { hasPipeline9ViaToBoardObstacleConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/hasPipeline9ViaToBoardObstacleConflict"
import type { SimpleRouteJson } from "lib/types"
import simpleRouteJson from "../../fixtures/bug-reports/bugreport106-full-gameboy-endpoint-vias/bugreport106-full-gameboy-endpoint-vias.srj.json" with {
  type: "json",
}

test("Pipeline9 keeps full Game Boy endpoint vias clear of foreign pads", () => {
  const srj = structuredClone(simpleRouteJson) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
    effort: 1,
  })

  expect(srj.connections).toHaveLength(145)
  expect(srj.obstacles).toHaveLength(675)
  expect(srj.traces).toHaveLength(0)

  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.traceSimplificationSolver).toBeDefined()
  expect(
    hasPipeline9ViaToBoardObstacleConflict({
      routes: solver.traceSimplificationSolver!.simplifiedHdRoutes,
      boardObstacles: srj.obstacles,
      connMap: solver.connMap,
      layerCount: srj.layerCount,
      viaToPadClearance: srj.minViaEdgeToPadEdgeClearance ?? 0.1,
    }),
  ).toBeFalse()
})
