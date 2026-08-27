import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import boardPhase from "../../fixtures/bug-reports/am62l-hdmi-bus-constraints/am62l-hdmi-clock-pair.srj.json" with {
  type: "json",
}
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"

const CLOCK_PAIR_CONNECTIONS = ["source_trace_30", "source_trace_31"]

const getTraceLength = (trace: SimplifiedPcbTrace): number => {
  const points = trace.route.flatMap((routePoint) =>
    routePoint.route_type === "wire" || routePoint.route_type === "via"
      ? [{ x: routePoint.x, y: routePoint.y }]
      : [],
  )
  return points.slice(1).reduce((length, point, pointIndex) => {
    const previousPoint = points[pointIndex]!
    return (
      length + Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y)
    )
  }, 0)
}

test("AM62L HDMI clock pair stays within its maximum length skew", async () => {
  const inputSrj = structuredClone(boardPhase) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
    visualizationTraceColorMode: "net",
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const clockBus = inputSrj.buses?.find((bus) =>
    CLOCK_PAIR_CONNECTIONS.every((connectionName) =>
      bus.connectionNames.includes(connectionName),
    ),
  )
  if (clockBus?.maxLengthSkew === undefined) {
    throw new Error("Expected the TMDS clock pair to declare maximum skew")
  }
  expect(clockBus.maxLengthSkew).toBe(0.5)

  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const routedLengths = CLOCK_PAIR_CONNECTIONS.map((connectionName) =>
    routedTraces
      .filter((trace) => trace.connection_name === connectionName)
      .reduce((length, trace) => length + getTraceLength(trace), 0),
  )
  const routedSkew = Math.abs(routedLengths[0]! - routedLengths[1]!)

  // source_trace_30 is U5.TXC_POS -> U6.CLK_POS -> J2.pin10.
  // source_trace_31 is U5.TXC_NEG -> U6.CLK_NEG -> J2.pin12.
  expect(routedSkew).toBeLessThanOrEqual(clockBus.maxLengthSkew)

  const routedGraphics: GraphicsObject = convertSrjToGraphicsObject(
    { ...inputSrj, traces: routedTraces },
    { traceColorMode: "net" },
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
      text: `TMDS_CLK skew: ${routedSkew.toFixed(2)}mm (maximum: 0.50mm)`,
      fontSize: 0.7,
      color: "#166534",
      anchorSide: "center_left",
    },
  ]

  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "AM62L HDMI • clock pair length-skew constraint honored",
          pipeline: "end",
          graphics: routedGraphics,
        },
      ],
      columns: 1,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
