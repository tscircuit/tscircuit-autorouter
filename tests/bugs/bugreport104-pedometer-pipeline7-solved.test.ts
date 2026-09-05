import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import pedometer from "../../fixtures/bug-reports/bugreport104-pedometer-v1.0.6.unrouted.srj.json" with {
  type: "json",
}

// Run manually to regenerate the solved-board snapshot; keep skipped in CI.
test.skip("bugreport104 Pipeline7 solved board without preloaded traces", async () => {
  const input: SimpleRouteJson = {
    ...structuredClone(pedometer as SimpleRouteJson),
    traces: [],
  }
  const solver = new AutoroutingPipelineSolver7_MultiGraph(input, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.failed, `Pipeline7 failed: ${solver.error}`).toBe(false)
  expect(solver.solved).toBe(true)
  const output = solver.getOutputSimpleRouteJson()
  expect(output.traces!.length).toBeGreaterThan(0)
  expect(
    evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: output.traces!,
    }).errors,
  ).toHaveLength(0)
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: output.traces!,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
