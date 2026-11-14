import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { type GraphicsObject, getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("A64 native DDR initial path search", async (): Promise<void> => {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "../fixtures/assets/a64-ddr-edge-lookup/input.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  let initialSearch: BaseSolver | null = null
  while (
    !solver.failed &&
    !solver.solved &&
    !initialSearch?.solved &&
    !initialSearch?.failed
  ) {
    solver.step()
    initialSearch ??= solver.portPointPathingSolver?.activeSubSolver ?? null
  }
  if (!initialSearch) throw new Error("A64 never reached path planning")

  expect(input.connections).toHaveLength(43)
  const graphics: GraphicsObject = convertSrjToGraphicsObject(input)
  const plan = initialSearch.preview()
  graphics.title = plan.title
  graphics.lines = [...(graphics.lines ?? []), ...(plan.lines ?? [])]
  graphics.circles = [...(graphics.circles ?? []), ...(plan.circles ?? [])]
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
