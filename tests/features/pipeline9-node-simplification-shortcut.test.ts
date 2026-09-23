import { expect, test } from "bun:test"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { materializePipeline9HdRouteVias } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/materializePipeline9HdRouteVias"
import { simplifyPipeline9CollinearRoutePoints } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/simplifyPipeline9CollinearRoutePoints"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createNodeSimplification } from "tests/fixtures/node-simplification"
import input from "../fixtures/am3352-force-improve-dense-grid.json"

test("node-local grid reduction preserves the established force-improvement result", () => {
  const routes = input.hdRoutes as HighDensityRoute[]
  const original = structuredClone(routes)
  const solver = createNodeSimplification({
    routes,
    node: input.nodeWithPortPoints[0]!,
  })
  solver.solve()
  expect(solver.stats.inputPoints).toBe(4735)
  expect(solver.stats.outputPoints).toBeLessThan(1000)
  expect(routes).toEqual(original)
  const baseline = new HighDensityForceImproveSolver({
    ...input,
    hdRoutes: simplifyPipeline9CollinearRoutePoints(
      materializePipeline9HdRouteVias(routes),
    ),
  })
  const early = new HighDensityForceImproveSolver({
    ...input,
    hdRoutes: simplifyPipeline9CollinearRoutePoints(
      materializePipeline9HdRouteVias(solver.getOutput()),
    ),
  })
  baseline.solve()
  early.solve()
  expect(early.solved).toBeTrue()
  expect(baseline.solved).toBeTrue()
  expect(early.getOutput()).toEqual(baseline.getOutput())
})
