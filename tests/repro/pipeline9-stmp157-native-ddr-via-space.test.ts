import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
} from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("routes STM32MP157 DDR signals around the four completed data bytes", async (): Promise<void> => {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "../fixtures/assets/stmp157-native-ddr-via-space/input.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  expect(input.obstacles).toHaveLength(710)
  expect(input.traces?.filter((trace) => trace.isFixed)).toHaveLength(32)

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()

  const output = solver.solved ? solver.getOutputSimpleRouteJson() : input
  const graphics = convertSrjToGraphicsObject(output)
  graphics.points = []
  const status = solver.solved
    ? "All 40 remaining nets routed"
    : "Remaining routing failed"
  await expect(
    getSvgFromGraphicsObject(
      stackGraphicsHorizontally([graphics], {
        titles: [`STM32MP157 DDR | 32 fixed data nets | ${status}`],
      }),
      { backgroundColor: "white" },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
