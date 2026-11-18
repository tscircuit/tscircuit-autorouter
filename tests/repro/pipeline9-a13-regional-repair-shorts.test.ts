import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

test("route the native A13 remaining signals after the four data phases", async (): Promise<void> => {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/a13-fixed-copper/remaining64-bus060.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const drcOptions = {
    traceClearance: input.minTraceToPadEdgeClearance,
    viaToPadClearance: input.minViaEdgeToPadEdgeClearance,
  }
  const { errors } = evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
    drcOptions,
  })
  // Via cleanup must not add to the baseline's nine remaining issues.
  expect(errors.length).toBeLessThanOrEqual(9)
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
      drcOptions,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
