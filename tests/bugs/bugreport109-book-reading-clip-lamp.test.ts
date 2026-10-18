import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getPendingEffectsFromSolverTree } from "lib/solvers/getPendingEffectsFromSolverTree"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import capturedInput from "../../fixtures/bug-reports/bugreport109-book-reading-clip-lamp/bugreport109-book-reading-clip-lamp.srj.json" with {
  type: "json",
}

test("bugreport109: Pipeline 9 routes the full reading lamp circuit", async (): Promise<void> => {
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

  expect(solver.error).toBeNull()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const expectedPairs = solver
    .srjWithPointPairs!.connections.map((connection) =>
      connection.pointsToConnect.map((point) => point.pcb_port_id!).sort(),
    )
    .sort()
  const routedPairs = routedTraces
    .map((trace) => [...trace.connectsTo!].sort())
    .sort()
  expect(routedPairs).toEqual(expectedPairs)
  expect(
    evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }).errors,
  ).toHaveLength(0)
  // Native routing can produce different valid route variants across platforms.
  const snapshotPath =
    process.platform === "linux"
      ? import.meta.path.replace(/\.test\.ts$/, "-linux.test.ts")
      : import.meta.path
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }),
  ).toMatchSvgSnapshot(snapshotPath)
}, 900_000)
