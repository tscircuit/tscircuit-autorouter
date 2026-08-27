import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"

test("Pipeline9 ignores a multipoint bus trace width", async (): Promise<void> => {
  const inputSrj: SimpleRouteJson = {
    bounds: { minX: -7, maxX: 7, minY: -3, maxY: 3 },
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    obstacles: [],
    connections: [
      {
        name: "TMDS_P",
        pointsToConnect: [
          { x: -5, y: 0, layer: "top", pointId: "source" },
          { x: 0, y: 0, layer: "top", pointId: "protector" },
          { x: 5, y: 0, layer: "top", pointId: "connector" },
        ],
      },
    ],
    buses: [
      {
        busId: "TMDS_PAIR",
        connectionNames: ["TMDS_P"],
        traceWidth: 0.4,
      },
    ],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
    visualizationTraceColorMode: "net",
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const routedWireWidths = new Set(
    routedTraces.flatMap((trace) =>
      trace.route.flatMap((routePoint) =>
        routePoint.route_type === "wire" ? [routePoint.width] : [],
      ),
    ),
  )
  expect(routedWireWidths).toEqual(new Set([0.1]))

  const routedGraphics: GraphicsObject = convertSrjToGraphicsObject(
    { ...inputSrj, traces: routedTraces },
    { traceColorMode: "net" },
  )
  routedGraphics.texts = [
    ...(routedGraphics.texts ?? []),
    {
      x: -5,
      y: 2.25,
      text: "BUS REQUEST: 0.40mm",
      fontSize: 0.38,
      color: "black",
      anchorSide: "center_left",
    },
    {
      x: -5,
      y: 1.65,
      text: "PIPELINE9 OUTPUT: 0.10mm",
      fontSize: 0.38,
      color: "#b91c1c",
      anchorSide: "center_left",
    },
  ]

  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "BUG • bus requests 0.40mm; Pipeline9 routes 0.10mm",
          pipeline: "end",
          graphics: routedGraphics,
        },
      ],
      columns: 1,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
