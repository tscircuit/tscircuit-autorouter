import { expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import capturedInput from "../../fixtures/bug-reports/bugreport107-gba-dangling-top-terminals/bugreport107-gba-dangling-top-terminals.srj.json" with {
  type: "json",
}

test("bugreport107 Pipeline9 native Game Boy dangling top terminals", async (): Promise<void> => {
  const input = structuredClone(capturedInput) as SimpleRouteJson
  expect(input.layerCount).toBe(2)
  expect(input.allowBlindAndBuriedVias).toBe(false)
  expect(input.connections).toHaveLength(137)
  expect(input.obstacles).toHaveLength(452)
  expect(input.traces).toBeUndefined()
  expect(input.buses).toHaveLength(5)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    effort: 1,
  })
  solver.solve()

  expect(solver.failed, `Pipeline9 failed: ${solver.error}`).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.error).toBeNull()
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(routedTraces.length).toBeGreaterThan(0)
  const srjWithPointPairs = solver.srjWithPointPairs
  if (!srjWithPointPairs) {
    throw new Error("The completed solver did not produce point-paired SRJ")
  }

  const artifactsDirectory = new URL("../../artifacts/", import.meta.url)
  mkdirSync(artifactsDirectory, { recursive: true })
  writeFileSync(
    new URL("gba-native-dangling-output.json", artifactsDirectory),
    JSON.stringify(routedTraces, null, 2),
  )

  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs,
      routedTraces,
      // Preserve the captured board's declared trace-to-pad clearance.
      drcOptions: {
        traceClearance: input.minTraceToPadEdgeClearance,
      },
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
