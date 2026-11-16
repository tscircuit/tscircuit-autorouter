import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getPendingEffectsFromSolverTree } from "lib/solvers/getPendingEffectsFromSolverTree"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import capturedInput from "../../fixtures/bug-reports/nema-23-stepper-controller/nema-23-stepper-controller.srj.json" with {
  type: "json",
}

// Captured from imrishabh18/nema-23-stepper-controller v1.4.24 after removing
// its hand-routed copper and saved router. Core checks the board's per-trace
// length and via limits after routing because they are absent from this SRJ.
test("Pipeline 9 routes the NEMA 23 stepper controller", async (): Promise<void> => {
  const input = structuredClone(capturedInput) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    effort: 1,
  })
  while (!solver.solved && !solver.failed) {
    solver.step()
    const effects = getPendingEffectsFromSolverTree(solver)
    if (effects.length > 0) {
      await Promise.all(effects.map((effect) => effect.promise))
    }
  }

  expect(solver.solved, solver.error ?? "").toBe(true)
  const srjWithPointPairs = solver.srjWithPointPairs!
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const expectedPairs = srjWithPointPairs.connections
    .map((connection) =>
      connection.pointsToConnect.map((point) => point.pcb_port_id!).sort(),
    )
    .sort()
  const routedPairs = routedTraces
    .map((trace) => [...trace.connectsTo!].sort())
    .sort()
  expect(routedPairs).toEqual(expectedPairs)

  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs,
      routedTraces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
