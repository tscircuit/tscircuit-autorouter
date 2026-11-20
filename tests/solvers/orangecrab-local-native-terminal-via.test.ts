import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

// Real OrangeCrab-local other_signals input captured from the original TSX on
// tscircuit 0.0.3257 / core 0.0.2436 / capacity-autorouter 0.0.1139.
// Includes 52 native traces (16 fixed), without trace-to-rectangle conversion.
test("OrangeCrab exposes A01's missing terminal via", async (): Promise<void> => {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL("../fixtures/orangecrab-local-native-copper.srj.json.gz", import.meta.url),
      ),
    ).toString(),
  )
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  expect(() => solver.solve()).toThrow("without an explicit via")
  await expect(
    getLastStepSvg(convertSrjToGraphicsObject(input)),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "circuit" })
  await expect(
    getLastStepSvg(solver.highDensityRouteSolver!.visualize()),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "routing" })
})
