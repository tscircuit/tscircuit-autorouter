import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import srjJson from "../../fixtures/bug-reports/xiao-rp2040-pipeline9-drc/xiao-rp2040-pipeline9-drc.srj.json" with {
  type: "json",
}

const srj = srjJson as SimpleRouteJson
const originalDrcIssueCount = 457

// Full-board routing can exceed the regular CI budget; opt in explicitly.
test.skipIf(process.env.RUN_XIAO_RP2040_FULL_SOLVE !== "1")(
  "XIAO RP2040 retains validated routing progress",
  async (): Promise<void> => {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(srj),
      { cacheProvider: null },
    )
    solver.solve()

    expect(solver.failed, `Pipeline9 failed: ${solver.error}`).toBe(false)
    expect(solver.solved).toBe(true)
    const routedTraces = solver.getOutputSimplifiedPcbTraces()
    expect(routedTraces.length).toBeGreaterThan(0)
    const srjWithPointPairs = solver.srjWithPointPairs
    if (!srjWithPointPairs) {
      throw new Error("Pipeline9 did not produce point-pair SRJ")
    }

    // Use this board's declared copper clearances and board-edge margin.
    const evaluation = {
      inputSrj: srj,
      srjWithPointPairs,
      routedTraces,
      drcOptions: {
        traceClearance: srj.minTraceToPadEdgeClearance,
        viaClearance: srj.minPadEdgeToPadEdgeClearance,
      },
      includeBoardClearance: true,
    }
    const { errors } = evaluateRelaxedDrc(evaluation)
    expect(errors.length).toBeLessThan(originalDrcIssueCount)
    await expect(getBugReportSnapshotSvg(evaluation)).toMatchSvgSnapshot(
      import.meta.path,
    )
  },
)
