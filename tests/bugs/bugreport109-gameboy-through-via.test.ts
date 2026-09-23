import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import board from "../../fixtures/bug-reports/bugreport109-gameboy-through-via/bugreport109-gameboy-through-via.srj.json" with {
  type: "json",
}

// The full board takes several minutes locally. Keep the exact production-size
// reproduction available without adding that cost to ordinary pull-request CI.
test.skipIf(process.env.RUN_GAMEBOY_THROUGH_VIA_FULL_SOLVE !== "1")(
  "Pipeline9 routes the four-layer Game Boy while respecting through-via copper",
  async (): Promise<void> => {
    const inputSrj = structuredClone(board) as SimpleRouteJson
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
      cacheProvider: null,
    })

    expect(inputSrj.layerCount).toBe(4)
    expect(inputSrj.allowBlindAndBuriedVias).toBe(false)
    expect(inputSrj.connections).toHaveLength(144)
    expect(inputSrj.traces ?? []).toHaveLength(0)

    solver.solve()

    expect(solver.failed, solver.error ?? "").toBe(false)
    expect(solver.solved).toBe(true)

    const drcInput = {
      inputSrj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    }
    const { errors } = evaluateRelaxedDrc(drcInput)

    await expect(getBugReportSnapshotSvg(drcInput)).toMatchSvgSnapshot(
      import.meta.path,
    )

    // This is the failure condition. With blind/buried vias disabled, every
    // generated via occupies all four copper layers, but Pipeline9 currently
    // pathfinds using only the logical from/to layer span.
    expect(errors).toHaveLength(0)
  },
  900_000,
)
