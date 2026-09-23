import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { createPipeline9LengthMatchingPreloadedInput } from "../fixtures/createPipeline9LengthMatchingPreloadedInput"

test("Pipeline9 length matching tight-preload snapshot", async (): Promise<void> => {
  const srj = createPipeline9LengthMatchingPreloadedInput(0.3)
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
})
