import { expect, spyOn, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import * as createObjectsWithZLayersModule from "lib/utils/createObjectsWithZLayers"
import type { SimpleRouteJson } from "lib/types"

const ROUTED_NODE_COUNT = 24

test("H616 high-density nodes skip through-obstacle layer setup without a transition", (): void => {
  const { inputSrj } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/h616-native-ddr-clearance.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as { inputSrj: SimpleRouteJson }
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    inputSrj,
    { cacheProvider: null },
  )
  pipeline.solveUntilPhase("highDensityRouteSolver")
  pipeline.step()
  const highDensity = pipeline.highDensityRouteSolver!
  let layeredObstacles = 0
  const createObjectsWithZLayers =
    createObjectsWithZLayersModule.createObjectsWithZLayers
  spyOn(
    createObjectsWithZLayersModule,
    "createObjectsWithZLayers",
  ).mockImplementation(((objects, layerCount) => {
    layeredObstacles += objects.length
    return createObjectsWithZLayers(objects, layerCount)
  }) as typeof createObjectsWithZLayers)
  while (Number(highDensity.stats.regularNodeCount) < ROUTED_NODE_COUNT) {
    highDensity.step()
  }
  expect(highDensity.failed).toBeFalse()

  const svg = getSvgFromGraphicsObject(
    {
      rects: highDensity.routes.slice(0, 200).map((route) => ({
        center: route.route[0]!,
        width: route.traceThickness,
        height: route.traceThickness,
        fill: "#2563eb",
      })),
    },
    { backgroundColor: "white" },
  )
  const summary = `<g data-testid="layered-obstacles"><rect x="12" y="12" width="470" height="44" rx="6" fill="white" stroke="#166534"/><text x="24" y="40" font-family="Arial, sans-serif" font-size="20" fill="#166534">Obstacles layer-normalized: ${layeredObstacles}</text></g>`
  expect(svg.replace("</svg>", `${summary}</svg>`)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
