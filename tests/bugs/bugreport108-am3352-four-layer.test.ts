import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { getAm3352FailureSnapshotSvg } from "../../fixtures/bug-reports/bugreport108-am3352-four-layer/getAm3352FailureSnapshotSvg"
import board from "../../fixtures/bug-reports/bugreport108-am3352-four-layer/am3352-four-layer.srj.json" with {
  type: "json",
}

// Full routing takes about 21 minutes locally. Extracted solver regressions run
// in normal CI; opt into this uncached board reproduction explicitly.
test.skipIf(process.env.RUN_AM3352_FULL_SOLVE !== "1")(
  "bugreport108 routes through repair and reproduces the remaining DDR length-matching failure",
  async (): Promise<void> => {
    const input = structuredClone(board) as SimpleRouteJson
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
      cacheProvider: null,
    })
    let lastPhase = ""
    while (
      solver.getCurrentPhase() !== "lengthMatchingPostProcessingSolver" &&
      !solver.solved &&
      !solver.failed
    ) {
      const phase = solver.getCurrentPhase()
      if (phase !== lastPhase) {
        console.info(`AM3352: ${phase}`)
        lastPhase = phase
      }
      solver.step()
    }
    expect(solver.failed, solver.error ?? "").toBe(false)
    expect(solver.getCurrentPhase()).toBe("lengthMatchingPostProcessingSolver")
    const routedTraces = solver.getNewTracesBeforePowerExpansion()
    expect(routedTraces.length).toBeGreaterThan(0)
    // Assert the exact remaining failure; unrelated exceptions must fail this test.
    expect(() => solver.solve()).toThrow(
      /LengthMatchingSolver: linear regression exhausted all segment\/tooth combinations for "source_net_70"; required 5\.1637mm/,
    )
    expect(solver.failed).toBe(true)
    expect(solver.solved).toBe(false)
    await expect(
      getAm3352FailureSnapshotSvg({
        inputSrj: input,
        srjWithPointPairs: solver.srjWithPointPairs!,
        routedTraces,
      }),
    ).toMatchSvgSnapshot(import.meta.path)
  },
)
