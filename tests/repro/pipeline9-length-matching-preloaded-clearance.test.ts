import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { createPipeline9LengthMatchingPreloadedInput } from "../fixtures/createPipeline9LengthMatchingPreloadedInput"

test("length matching rejects unsafe output and preserves clearance", async (): Promise<void> => {
  for (const preloadedY of [0.3, 1]) {
    const srj = createPipeline9LengthMatchingPreloadedInput(preloadedY)
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
      cacheProvider: null,
    })
    solver.solveUntilPhase("lengthMatchingPostProcessingSolver")
    expect(
      evaluateRelaxedDrc({
        inputSrj: srj,
        srjWithPointPairs: solver.srjWithPointPairs!,
        routedTraces: solver.getNewTracesBeforePowerExpansion(),
      }).errors,
    ).toHaveLength(0)
    if (preloadedY === 0.3) {
      const before = {
        inputSrj: srj,
        srjWithPointPairs: solver.srjWithPointPairs!,
        routedTraces: solver.getNewTracesBeforePowerExpansion(),
      }
      expect(() => solver.solve()).toThrow(
        "exhausted all segment/tooth combinations",
      )
      expect(solver.failed).toBe(true)
      expect(solver.solved).toBe(false)
      expect(() => solver.getOutputSimplifiedPcbTraces()).toThrow(
        "Cannot get output",
      )
      // Only the safe pre-match geometry is shown: this is not a solved board.
      const svg = getBugReportSnapshotSvg(before).replace(
        "</svg>",
        '<text x="24" y="86" font-family="Arial, sans-serif" font-size="16" fill="#b91c1c">REJECTED: no output. Pre-match geometry shown.</text></svg>',
      )
      await expect(svg).toMatchSvgSnapshot(import.meta.path, {
        svgName: "tight-preload",
      })
      continue
    }
    solver.solve()
    expect(solver.solved).toBe(true)
    const drcInput = {
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    }
    expect(evaluateRelaxedDrc(drcInput).errors).toHaveLength(0)
    await expect(getBugReportSnapshotSvg(drcInput)).toMatchSvgSnapshot(
      import.meta.path,
      {
        svgName: preloadedY === 0.3 ? "tight-preload" : "roomy-preload",
      },
    )
  }
})
