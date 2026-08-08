import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type { SimpleRouteJson } from "lib/types"
import scenario from "./features/preexisting-connected-traces/srj/preexisting-connected-traces06.srj.json" with {
  type: "json",
}

test("Pipeline9 produces solver-compatible post-processing input", () => {
  const srj = structuredClone(scenario) as SimpleRouteJson
  const legacyOval = { ...srj.obstacles[0], type: "oval" }
  srj.obstacles[0] = legacyOval as unknown as (typeof srj.obstacles)[number]
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    targetMinCapacity: 0.75,
    maxNodeDimension: 3,
    effort: 0.1,
  })

  solver.solve()

  const input = solver.lengthMatchingPostProcessingSolver!.inputProblem
  expect(input.obstacles[0]).toMatchObject({
    type: "rect",
    center: legacyOval.center,
    width: legacyOval.width,
    height: legacyOval.height,
  })
  expect(solver.lengthMatchingPostProcessingSolver!.solved).toBe(true)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
})
