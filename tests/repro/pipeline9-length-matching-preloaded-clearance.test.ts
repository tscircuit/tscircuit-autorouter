import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { createPipeline9LengthMatchingPreloadedInput } from "../fixtures/createPipeline9LengthMatchingPreloadedInput"

test("reproduce length matching violating preloaded copper clearance", async (): Promise<void> => {
  for (const preloadedY of [0.3, 1]) {
    const srj = createPipeline9LengthMatchingPreloadedInput(preloadedY)
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, { cacheProvider: null })
    solver.solveUntilPhase("lengthMatchingPostProcessingSolver")
    expect(evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getNewTracesBeforePowerExpansion(),
    }).errors).toHaveLength(0)
    solver.solve()
    expect(solver.solved).toBe(true)
    const drcInput = {
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    }
    // This snapshot records the bug; the feature test asserts desired safety.
    expect(evaluateRelaxedDrc(drcInput).errors.length).toBeGreaterThan(0)
    await expect(getBugReportSnapshotSvg(drcInput)).toMatchSvgSnapshot(import.meta.path, {
      svgName: preloadedY === 0.3 ? "tight-preload" : "roomy-preload",
    })
  }
})
