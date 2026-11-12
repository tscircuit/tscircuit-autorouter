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

test("routes STMP157 DDR with fixed data copper", async (): Promise<void> => {
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
  const reference: SimpleRouteJson = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "../fixtures/assets/stmp157-native-ddr-via-space/physical-reference.srj.json.gz",
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

  // On failure, only the previously completed data copper is publishable.
  let output = reference
  let status = "Remaining DDR routing failed"
  if (solver.solved) {
    output = {
      ...reference,
      traces: [
        ...reference.traces!,
        ...solver.getOutputSimplifiedPcbTraces(),
      ],
    }
    status = "Remaining DDR routing completed"
  }
  const graphics = convertSrjToGraphicsObject(output)
  graphics.points = []
  await expect(
    getSvgFromGraphicsObject(
      stackGraphicsHorizontally([graphics], {
        titles: [`STMP157 native DDR | ${status}`],
      }),
      { backgroundColor: "white" },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
