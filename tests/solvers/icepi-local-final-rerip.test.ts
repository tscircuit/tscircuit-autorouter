import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject, mergeGraphics } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("IcePi local other_signals reaches detailed routing", () => {
  // Full original other_signals phase, including all prior routed copper.
  const input = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL("../fixtures/icepi-local-other-signals.json.gz", import.meta.url),
      ),
    ).toString("utf8"),
  ) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  while (!solver.failed && !solver.solved && !solver.highDensityRouteSolver) {
    solver.step()
  }
  const pathing = solver.portPointPathingSolver
  expect(pathing).toBeDefined()
  if (!pathing) throw new Error("IcePi did not reach port-point pathing")
  expect(pathing.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(
    getSvgFromGraphicsObject(
      mergeGraphics(convertSrjToGraphicsObject(input), pathing.preview()),
      { backgroundColor: "white" },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
