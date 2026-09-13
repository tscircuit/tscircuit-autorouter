import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import capturedInput from "../../fixtures/bug-reports/bugreport105-gba-native-foreign-net-shorts/bugreport105-gba-native-foreign-net-shorts.srj.json" with {
  type: "json",
}

test("Pipeline9 native full-board Game Boy Advance foreign-net shorts", async (): Promise<void> => {
  // Exact TSCI input: no authored routes, breakouts, or child subcircuits.
  const input = structuredClone(capturedInput) as SimpleRouteJson
  expect(input.layerCount).toBe(2)
  expect(input.allowBlindAndBuriedVias).toBe(false)
  expect(input.connections).toHaveLength(137)
  expect(input.obstacles).toHaveLength(452)
  expect(input.traces).toBeUndefined()

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    effort: 1,
  })
  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(routedTraces.length).toBeGreaterThan(0)
  const srjWithPointPairs = solver.srjWithPointPairs
  if (!srjWithPointPairs) {
    throw new Error("The full-board solver did not produce point-paired SRJ")
  }

  // Use the board's declared trace clearance, not the relaxed 0.1mm default.
  // The helper's other benchmark checks are not a complete Core/fab gate.
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs,
      routedTraces,
      drcOptions: { traceClearance: input.minTraceToPadEdgeClearance },
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
