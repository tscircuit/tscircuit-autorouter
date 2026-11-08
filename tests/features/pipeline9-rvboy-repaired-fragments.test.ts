import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { assignUniquePcbTraceIdsToNewTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/assignUniquePcbTraceIdsToNewTraces"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { stitchPipeline9RepairedFragments } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/stitchPipeline9RepairedFragments"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderPlanarShortcutView } from "../fixtures/renderPlanarShortcutView"

test("RVboy repair fragments become a terminal path without cut-boundary stubs", async (): Promise<void> => {
  // Full captured board at cleanup entry; only the rendered viewport is cropped.
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-repaired-fragments.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as {
    input: SimpleRouteJson
    prepared: SimpleRouteJson
    negotiated: {
      routes: HighDensityRoute[]
      preloadedTraces: SimplifiedPcbTraces
    }
  }
  const before = fixture.negotiated.routes
  const original = structuredClone(before)
  const input = { ...fixture.input, traces: fixture.negotiated.preloadedTraces }
  const connMap = getConnectivityMapFromSimpleRouteJson(fixture.prepared)
  const convert = (routes: HighDensityRoute[]): SimplifiedPcbTraces =>
    assignUniquePcbTraceIdsToNewTraces(
      convertPipeline7HdRoutesToSimplifiedPcbTraces({
        hdRoutes: routes,
        connections: fixture.prepared.connections,
        originalConnections: input.connections,
        layerCount: input.layerCount,
        obstacles: fixture.prepared.obstacles,
        defaultViaHoleDiameter: 0.2,
        connMap,
      }),
      input.traces!,
    )
  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: input,
    srjWithPointPairs: fixture.prepared,
    includeBoardClearance: true,
    drcOptions: { traceClearance: 0.1, viaClearance: 0.4 },
  })
  expect(evaluate(convert(before)).errors).toEqual([])
  const after = stitchPipeline9RepairedFragments({
    routes: before,
    connections: fixture.prepared.connections,
    isValid: (routes) => evaluate(convert(routes)).errors.length === 0,
  })
  expect(before).toEqual(original)
  expect(before).toHaveLength(483)
  expect(after).toHaveLength(481)
  const rgb = after.filter((route) => route.connectionName === "source_net_66")
  expect(rgb).toHaveLength(1)
  expect(rgb[0]!.startPcbPortId).toBe("pcb_port_244")
  expect(rgb[0]!.endPcbPortId).toBe("pcb_port_653")
  expect(rgb[0]!.route[0]).toMatchObject({ x: 6, y: 12.875, z: 0 })
  expect(rgb[0]!.route.at(-1)).toMatchObject({ x: 45.3, y: 12.65, z: 0 })
  for (const [x, y] of [
    [7.02, 4.87541757964596],
    [7.02, 5.03],
    [6.0128, 4.58],
    [6.325, 5.735],
  ])
    expect(
      rgb[0]!.route.some(
        (point) => Math.hypot(point.x - x!, point.y - y!) < 1e-6,
      ),
    ).toBeFalse()
  expect(
    after.filter((route) => route.connectionName !== "source_net_66"),
  ).toEqual(before.filter((route) => route.connectionName !== "source_net_66"))
  expect(evaluate(convert(after)).errors).toEqual([])
  expect(
    stitchPipeline9RepairedFragments({
      routes: before,
      connections: fixture.prepared.connections,
      isValid: () => false,
    }),
  ).toBe(before)
  for (const [state, routes] of [
    ["before", before],
    ["after", after],
  ] as const) {
    const graphics = convertSrjToGraphicsObject({
      ...input,
      obstacles: input.obstacles.filter((obstacle) => !obstacle.isCopperPour),
      connections: [],
      traces: [...input.traces!, ...convert(routes)],
    })
    await expect(
      renderPlanarShortcutView(graphics, {
        minX: 5.5,
        maxX: 7.6,
        minY: 4.15,
        maxY: 6.25,
      }),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: state })
  }
})
