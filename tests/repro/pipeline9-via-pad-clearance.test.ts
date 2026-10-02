import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import board from "../../fixtures/bug-reports/metal-touch-via-pad-clearance.srj.json" with {
  type: "json",
}

const srj = board as SimpleRouteJson

test("Pipeline 9 respects the board's declared via-to-pad clearance", async (): Promise<void> => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )
  solver.solve()

  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.solved).toBe(true)
  const drcInput = {
    inputSrj: srj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
    showDrcErrorMarkers: true,
    // Validate this board's declared rules, not only benchmark defaults.
    drcOptions: {
      traceClearance: srj.minTraceToPadEdgeClearance,
      viaToPadClearance: srj.minViaEdgeToPadEdgeClearance,
    },
  }
  await expect(
    getBugReportSnapshotSvg(drcInput).replace(/[ \t]+$/gm, ""),
  ).toMatchSvgSnapshot(import.meta.path)
  expect(evaluateRelaxedDrc(drcInput).errors).toEqual([])
})
