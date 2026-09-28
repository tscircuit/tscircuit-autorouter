import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../../lib/types"
import srj from "../fixtures/core-differential-pair-pad-clearance.json"

test("Pipeline9 preserves declared pad clearance when length matching", () => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    srj as SimpleRouteJson,
  )
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.postProcessingErrors).toMatchObject([
    {
      stage: "differentialPairReroutingSolver",
      reason: "no-valid-candidate",
      connectionNames: ["source_trace_0", "source_trace_1"],
    },
  ])
  expect(solver.lengthMatchingPostProcessingSolver?.getOutput().postProcessingErrors)
    .toEqual(solver.postProcessingErrors)
  expect(solver.powerTraceExpansionSolver?.solved).toBe(true)
  expect(solver.getOutputSimplifiedPcbTraces()).toHaveLength(2)
  const routes = solver._getOutputHdRoutes()
  expect(routes).toHaveLength(2)
  const lengths = routes.map((route) =>
    route.route.slice(1).reduce((length, point, pointIndex) => {
      const previous = route.route[pointIndex]!
      return length + Math.hypot(point.x - previous.x, point.y - previous.y)
    }, 0),
  )
  expect(Math.abs(lengths[0]! - lengths[1]!)).toBeLessThanOrEqual(0.05)
})
