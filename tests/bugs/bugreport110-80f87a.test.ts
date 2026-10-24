import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getPendingEffectsFromSolverTree } from "lib/solvers/getPendingEffectsFromSolverTree"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../fixtures/bug-reports/bugreport110-80f87a/bugreport110-80f87a.json" with {
  type: "json",
}

test("bugreport110: flex sensor routing with overlapping same-net vias", async (): Promise<void> => {
  const input = structuredClone(bugReport.simple_route_json) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  while (!solver.solved && !solver.failed) {
    solver.step()
    const effects = getPendingEffectsFromSolverTree(solver)
    if (effects.length > 0) {
      await Promise.all(effects.map((effect) => effect.promise))
    }
  }
  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.solved).toBe(true)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
