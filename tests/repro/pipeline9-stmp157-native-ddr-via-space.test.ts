import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  getSvgFromGraphicsObject,
  stackGraphicsHorizontally,
} from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
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

  expect(solver.solved, solver.error ?? "").toBe(true)
  const routes = solver.getOutputSimplifiedPcbTraces()
  expect(new Set(routes.map((trace) => trace.connection_name))).toEqual(
    new Set(input.connections.map((connection) => connection.name)),
  )
  expect(routes).toHaveLength(solver.srjWithPointPairs!.connections.length)
  // The source stack uses inner1, inner3 and inner6 for power and ground planes.
  const signalLayers = new Set(["top", "inner2", "inner4", "inner5", "bottom"])
  const routedWireLayers = new Set(
    routes.flatMap((trace) =>
      trace.route.flatMap((point) =>
        point.route_type === "wire" ? [point.layer] : [],
      ),
    ),
  )
  expect(routedWireLayers).toEqual(signalLayers)
  const checkCopper = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    includeBoardClearance: true,
    clearanceTolerance: 1e-9,
    drcOptions: {
      traceClearance: input.minTraceToPadEdgeClearance,
      viaToPadClearance: input.minViaEdgeToPadEdgeClearance,
      viaClearance: input.minViaHoleEdgeToViaHoleEdgeClearance,
      holeClearance: input.minTraceToHoleEdgeClearance,
    },
  })
  expect(checkCopper(routes).errors).toEqual([])
  const output = solver.getOutputSimpleRouteJson()
  expect(output.traces?.filter((trace) => trace.isFixed)).toEqual(input.traces)
  const graphics = convertSrjToGraphicsObject(output)
  graphics.points = []
  const status = `All ${input.connections.length} remaining nets routed`
  await expect(
    getSvgFromGraphicsObject(
      stackGraphicsHorizontally([graphics], {
        titles: [`STM32MP157 DDR | 32 fixed data nets | ${status}`],
      }),
      { backgroundColor: "white" },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
