import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getSvgFromGraphicsObject } from "graphics-debug"

// Real OrangeCrab-local other_signals input captured from the original TSX on
// tscircuit 0.0.3257 / core 0.0.2436 / capacity-autorouter 0.0.1139.
// Includes 52 native traces (16 fixed), without trace-to-rectangle conversion.
test("OrangeCrab passes overlapping cut terminals without a missing-via exception", async (): Promise<void> => {
  const fixture = readFileSync(
    new URL(
      "../fixtures/orangecrab-local-native-copper.srj.json.gz",
      import.meta.url,
    ),
  )
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(new Uint8Array(fixture)).toString(),
  )
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  expect(() => solver.solve()).not.toThrow()
  expect(solver.failed).toBeTrue()
  expect(solver.error).not.toContain("Unrelated route terminals overlap")
  expect(solver.error).not.toContain("without an explicit via")
  expect(solver.highDensityRouteSolver!.routes).toContainEqual(
    expect.objectContaining({
      regionId: "cmn_266",
      connectionName: "source_net_138_mst1",
    }),
  )
  await expect(
    getSvgFromGraphicsObject(convertSrjToGraphicsObject(input), {
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "circuit" })
  await expect(
    getSvgFromGraphicsObject(solver.highDensityRouteSolver!.visualize(), {
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "routing" })
})
