import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("generates the native STMP157 DDR component mesh", async (): Promise<void> => {
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
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  const topologyStep = solver.pipelineDef.findIndex(
    (step) => step.solverName === "topologyMergingSolver",
  )
  while (
    !solver.solved &&
    !solver.failed &&
    solver.currentPipelineStepIndex <= topologyStep
  ) {
    solver.step()
  }

  const graphics = solver.topologyMergingSolver!.visualize()
  // Show the actual CPU escape mesh beside U1.G20 at a readable scale.
  graphics.rects = [
    ...graphics.rects!,
    ...convertSrjToGraphicsObject(input).rects,
  ].filter(
    ({ center }) =>
      center.x >= -8.2 &&
      center.x <= -6.2 &&
      center.y >= 1.6 &&
      center.y <= 3.6,
  )
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
