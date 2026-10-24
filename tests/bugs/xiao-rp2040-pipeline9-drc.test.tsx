import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import srjJson from "../../fixtures/bug-reports/xiao-rp2040-pipeline9-drc/xiao-rp2040-pipeline9-drc.srj.json" with {
  type: "json",
}

const srj = srjJson as SimpleRouteJson

// Full uncached routing takes about seven minutes; opt in outside regular CI.
test.skipIf(process.env.RUN_XIAO_RP2040_FULL_SOLVE !== "1")(
  "XIAO RP2040 Pipeline9 records routing with the declared clearances",
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
    await expect(
      getBugReportSnapshotSvg({
        inputSrj: srj,
        srjWithPointPairs,
        routedTraces,
        drcOptions: {
          traceClearance: srj.minTraceToPadEdgeClearance,
          viaClearance: srj.minPadEdgeToPadEdgeClearance,
        },
        includeBoardClearance: true,
      }),
    ).toMatchSvgSnapshot(import.meta.path)
  },
)
