import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport106-347963/bugreport106-347963.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

const srj = bugReport.simple_route_json as SimpleRouteJson
const focusBounds = {
  minX: -16.7,
  maxX: -12.2,
  minY: -0.9,
  maxY: 3.6,
}

test("bugreport106-347963.json", async () => {
  const solver = new AutoroutingPipelineSolver(structuredClone(srj))
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const wireWidths = routedTraces.flatMap((trace) =>
    trace.route.flatMap((point) =>
      point.route_type === "wire" ? [point.width] : [],
    ),
  )
  const actualMinimumWidth = Math.min(...wireWidths)
  const displayedWidth = Number(actualMinimumWidth.toFixed(4))
  expect(actualMinimumWidth).toBeCloseTo(0.08, 3)
  expect(actualMinimumWidth).toBeLessThan(srj.minTraceWidth)
  const fullGraphics = convertSrjToGraphicsObject(
    { ...srj, traces: routedTraces },
    { traceColorMode: "net" },
  )
  const isMicrophoneGroundLine = (
    line: NonNullable<GraphicsObject["lines"]>[number],
  ) => line.label?.startsWith("source_net_0") ?? false
  const connectionLines = (fullGraphics.lines ?? []).filter(
    isMicrophoneGroundLine,
  )
  const violatingLines = connectionLines.filter(
    (line) => (line.strokeWidth ?? srj.minTraceWidth) < srj.minTraceWidth,
  )
  expect(violatingLines.length).toBeGreaterThan(0)
  const terminalRing = [
    { x: -16.08, y: 2.44 },
    { x: -15.76, y: 2.7 },
    { x: -15.3, y: 2.6 },
    { x: -14.94, y: 2.3 },
    { x: -14.78, y: 1.84 },
    { x: -14.78, y: 1.2 },
    { x: -15, y: 0.72 },
    { x: -15.38, y: 0.45 },
    { x: -15.84, y: 0.46 },
    { x: -16.14, y: 0.72 },
  ]
  const terminalSegment = [
    { x: -16.08, y: 2.44 },
    { x: -16.48, y: 2.22 },
  ]
  const inputGraphics = convertSrjToGraphicsObject(srj, {
    traceColorMode: "net",
  })
  const outline = srj.outline ?? []
  const closedOutline = outline.length > 0 ? [...outline, outline[0]!] : []
  const overviewGraphics: GraphicsObject = {
    ...inputGraphics,
    lines: [
      {
        points: closedOutline,
        strokeColor: "#475569",
        strokeWidth: 0.18,
        zIndex: -3,
      },
      ...(inputGraphics.lines ?? []),
      {
        points: terminalSegment,
        strokeColor: "rgba(220,38,38,0.22)",
        strokeWidth: 0.8,
        zIndex: 1,
      },
      {
        points: terminalSegment,
        strokeColor: "#dc2626",
        strokeWidth: displayedWidth,
        zIndex: 2,
        label: "source_net_0 0.0800 mm terminal segment",
      },
    ],
    circles: [
      ...(inputGraphics.circles ?? []),
      {
        center: { x: -16.08, y: 2.44 },
        radius: 0.7,
        fill: "rgba(255,255,255,0)",
        stroke: "#991b1b",
      },
    ],
    texts: [
      {
        x: 0,
        y: 37.3,
        text: "MIC GND: 0.0800 mm output / 0.1500 mm minimum",
        fontSize: 1.1,
        color: "#991b1b",
        anchorSide: "center",
      },
    ],
  }

  await expect(
    getSvgFromGraphicsObject(overviewGraphics, {
      backgroundColor: "white",
      svgWidth: 1000,
      svgHeight: 800,
    }),
  ).toMatchSvgSnapshot(import.meta.path)

  const focusedGraphics: GraphicsObject = {
    lines: [
      {
        points: terminalRing,
        strokeColor: "rgba(220,38,38,0.18)",
        strokeWidth: 0.32,
        zIndex: -1,
      },
      {
        points: terminalRing,
        strokeColor: "rgba(220,38,38,0.55)",
        strokeWidth: srj.minTraceWidth,
      },
      {
        points: [
          { x: -14.4, y: 0.25 },
          { x: -14.4, y: -0.35 },
          { x: -13.65, y: -0.35 },
        ],
        strokeColor: "rgba(124,58,237,0.12)",
        strokeWidth: 0.2,
        zIndex: -2,
      },
      {
        points: [
          { x: -16.3, y: 2.68 },
          { x: -16.3, y: 2.33 },
        ],
        strokeColor: "#991b1b",
        strokeWidth: 0.018,
      },
      {
        points: terminalSegment,
        strokeColor: "#dc2626",
        strokeWidth: displayedWidth,
        zIndex: 1,
        label: "0.0800 mm width guide",
      },
    ],
    rects: [
      {
        center: { x: -14.75, y: 0.15 },
        width: 0.5,
        height: 0.9,
        fill: "rgba(255,255,255,0)",
        stroke: "rgba(100,116,139,0.08)",
      },
      {
        center: { x: -12.85, y: -0.25 },
        width: 0.7,
        height: 0.75,
        fill: "rgba(220,38,38,0.10)",
        stroke: "none",
      },
      {
        center: {
          x: (focusBounds.minX + focusBounds.maxX) / 2,
          y: (focusBounds.minY + focusBounds.maxY) / 2,
        },
        width: focusBounds.maxX - focusBounds.minX,
        height: focusBounds.maxY - focusBounds.minY,
        fill: "rgba(255,255,255,0)",
        stroke: "none",
      },
    ],
    circles: [
      {
        center: { x: -15.45, y: 1.55 },
        radius: 0.72,
        fill: "rgba(220,38,38,0.04)",
        stroke: "rgba(220,38,38,0.12)",
      },
      {
        center: { x: -16.08, y: 2.44 },
        radius: 0.13,
        fill: "rgba(255,255,255,0)",
        stroke: "#991b1b",
      },
    ],
    points: [],
    texts: [
      {
        x: (focusBounds.minX + focusBounds.maxX) / 2,
        y: 3.28,
        text: `CURRENT ${displayedWidth.toFixed(4)} mm  •  EXPECTED MINIMUM ${srj.minTraceWidth.toFixed(4)} mm`,
        fontSize: 0.22,
        color: "#991b1b",
        anchorSide: "center",
      },
      {
        x: (focusBounds.minX + focusBounds.maxX) / 2,
        y: 2.92,
        text: "source_net_0 • microphone GND terminal",
        fontSize: 0.18,
        color: "#475569",
        anchorSide: "center",
      },
      {
        x: -16.32,
        y: 2.7,
        text: "0.0800 mm trace width",
        fontSize: 0.16,
        color: "#991b1b",
        anchorSide: "bottom_right",
      },
    ],
  }

  await expect(
    getSvgFromGraphicsObject(focusedGraphics, {
      backgroundColor: "white",
      svgWidth: 640,
      svgHeight: 640,
    }),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "microphone-terminal-width-zoom",
  })
}, 120_000)
