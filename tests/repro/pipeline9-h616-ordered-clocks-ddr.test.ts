import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

test("routes the native H616 DDR clocks and remaining signals", async (): Promise<void> => {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/h616-ordered-clocks-ddr.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as { srj: SimpleRouteJson; board: SimpleRouteJson }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(fixture.srj, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()

  await expect(
    getBugReportSnapshotSvg({
      inputSrj: fixture.board,
      srjWithPointPairs: {
        ...solver.srjWithPointPairs!,
        obstacles: fixture.board.obstacles,
      },
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
      drcOptions: { traceClearance: 0.1, viaToPadClearance: 0.1 },
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
