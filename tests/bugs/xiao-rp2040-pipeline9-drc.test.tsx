import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import srjJson from "../../fixtures/bug-reports/xiao-rp2040-pipeline9-drc/xiao-rp2040-pipeline9-drc.srj.json" with {
  type: "json",
}

const srj = srjJson as SimpleRouteJson

// Full-board routing can exceed the regular CI budget; opt in explicitly.
test.skipIf(process.env.RUN_XIAO_RP2040_FULL_SOLVE !== "1")(
  "XIAO RP2040 retains repair progress and rejects remaining clearance errors",
  async (): Promise<void> => {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(srj),
      { cacheProvider: null },
    )
    solver.solve()

    expect(solver.failed).toBe(true)
    expect(solver.solved).toBe(false)
    const finalStage = solver.powerTraceExpansionSolver
    const srjWithPointPairs = solver.srjWithPointPairs
    if (!srjWithPointPairs || !finalStage) {
      throw new Error("Pipeline9 did not complete the attempted routing")
    }
    const routedTraces = finalStage.getOutput()
    expect(routedTraces.length).toBeGreaterThan(0)

    // These are diagnostic routes; failed routing must not become board output.
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
    expect(errors.length).toBeGreaterThan(0)
    expect(solver.stats.finalDrcIssueCount).toBe(errors.length)
    expect(() => solver.getOutputSimpleRouteJson()).toThrow()
    expect(() => solver.getOutputSimplifiedPcbTraces()).toThrow()
    await expect(getBugReportSnapshotSvg(evaluation)).toMatchSvgSnapshot(
      import.meta.path,
    )
  },
)
