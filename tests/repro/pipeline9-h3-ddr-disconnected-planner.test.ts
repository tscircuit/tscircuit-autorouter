import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { type GraphicsObject, getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("identifies disconnected H3 DDR signals before reripping the other routes", async (): Promise<void> => {
  const inputSrj: SimpleRouteJson = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "../fixtures/assets/h3-ddr-disconnected-planner/input.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    effort: 1,
    cacheProvider: null,
  })
  solver.solve()

  const planner = solver.portPointPathingSolver!
  const iterations = planner.stats.stageStats.solveGraph.iterations
  const graphics: GraphicsObject = convertSrjToGraphicsObject(inputSrj)
  graphics.texts = [
    {
      x: inputSrj.bounds.minX,
      y: inputSrj.bounds.maxY + 3,
      text: "H3 DDR: existing copper and 37 remaining signals",
      fontSize: 0.65,
      anchorSide: "center_left",
    },
    {
      x: inputSrj.bounds.minX,
      y: inputSrj.bounds.maxY + 1.5,
      text: `Planner iterations: ${iterations}`,
      fontSize: 0.65,
      anchorSide: "center_left",
    },
  ]
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })

  expect(solver.failed).toBe(true)
  expect(planner.error).toBe(
    "No path for 10 (source_trace_46) after allowing movable routes to be rerouted",
  )
})
