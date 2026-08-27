import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import boardPhase from "../../fixtures/bug-reports/am62l-hdmi-bus-constraints/am62l-hdmi-pair0.srj.json" with {
  type: "json",
}
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"

const HDMI_D2_NEGATIVE_TRACE = "source_trace_25"

test("AM62L HDMI D2 pair escapes its top-only bus constraint", async () => {
  const inputSrj = structuredClone(boardPhase) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
    visualizationTraceColorMode: "layer",
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const d2Bus = inputSrj.buses?.find((bus) =>
    bus.connectionNames.includes(HDMI_D2_NEGATIVE_TRACE),
  )
  if (!d2Bus?.allowedLayers) {
    throw new Error("Expected TMDS_D2_N to belong to a layer-constrained bus")
  }
  const allowedLayers = d2Bus.allowedLayers
  expect(allowedLayers).toEqual(["top"])

  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const d2NegativeLayers = new Set(
    routedTraces
      .filter((trace) => trace.connection_name === HDMI_D2_NEGATIVE_TRACE)
      .flatMap((trace) =>
        trace.route.flatMap((routePoint) =>
          routePoint.route_type === "wire" ? [routePoint.layer] : [],
        ),
      ),
  )

  // source_trace_25 is TMDS_D2_N:
  // U5.TX2_NEG -> U6.D2_NEG -> J2.pin3 on the AM62L carrier.
  expect(
    [...d2NegativeLayers].every((layer) => allowedLayers.includes(layer)),
  ).toBe(false)

  const routedGraphics: GraphicsObject = convertSrjToGraphicsObject(
    { ...inputSrj, traces: routedTraces },
    { traceColorMode: "layer" },
  )
  routedGraphics.texts = [
    ...(routedGraphics.texts ?? []),
    {
      x: -32,
      y: 8,
      text: "U5 • SII9022ACNU",
      fontSize: 0.8,
      color: "black",
      anchorSide: "center",
    },
    {
      x: 0,
      y: 8,
      text: "U6 • TPD12S016PWR",
      fontSize: 0.8,
      color: "black",
      anchorSide: "center",
    },
    {
      x: 32,
      y: 10,
      text: "J2 • HDMI_001S",
      fontSize: 0.8,
      color: "black",
      anchorSide: "center",
    },
    {
      x: -20,
      y: -8,
      text: "TMDS_D2_N requests top; Pipeline9 emits top + inner1",
      fontSize: 0.7,
      color: "#b91c1c",
      anchorSide: "center_left",
    },
  ]

  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "AM62L HDMI • forbidden inner1 route",
          pipeline: "end",
          graphics: routedGraphics,
        },
      ],
      columns: 1,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
