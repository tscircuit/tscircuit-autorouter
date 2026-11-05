import { expect, test } from "bun:test"
import input from "./assets/glider-ddr-addr6.json"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

test("Glider DDR ADDR6 escape via", async () => {
  // Captured remaining-signal request; earlier DQ copper is already in its obstacles.
  const srj = input as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )
  solver.solve()
  expect(solver.solved).toBe(true)
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
      // Glider's captured board clearance.
      drcOptions: { traceClearance: 0.11, viaToPadClearance: 0.11 },
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
