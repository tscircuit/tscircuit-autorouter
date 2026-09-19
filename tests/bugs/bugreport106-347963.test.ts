import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport106-347963/bugreport106-347963.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { safeTransparentize } from "lib/solvers/colors"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

const srj = bugReport.simple_route_json as SimpleRouteJson
const focusBounds = {
  minX: -16.7,
  maxX: -12.2,
  minY: -0.9,
  maxY: 3.6,
}

const isInsideFocus = ({ x, y }: { x: number; y: number }) =>
  x >= focusBounds.minX &&
  x <= focusBounds.maxX &&
  y >= focusBounds.minY &&
  y <= focusBounds.maxY

const fadeColor = (color: string | undefined, amount = 0.88) => {
  if (!color || color === "none") return color
  return safeTransparentize(color, amount)
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
  expect(actualMinimumWidth).toBeLessThan(0.081)
  expect(actualMinimumWidth).toBeLessThan(srj.minTraceWidth)
  const fullGraphics = convertSrjToGraphicsObject(
    { ...srj, traces: routedTraces },
    { traceColorMode: "net" },
  )
  const focusedLines = (fullGraphics.lines ?? []).filter((line) =>
    line.points.every(isInsideFocus),
  )
  const isMicrophoneGroundLine = (line: (typeof focusedLines)[number]) =>
    line.label?.startsWith("source_net_0") ?? false
  const connectionLines = focusedLines.filter(isMicrophoneGroundLine)
  const violatingLines = connectionLines.filter(
    (line) => (line.strokeWidth ?? srj.minTraceWidth) < srj.minTraceWidth,
  )
  expect(violatingLines.length).toBeGreaterThan(0)
  const outline = srj.outline ?? []
  const contextConnectionLines = (fullGraphics.lines ?? []).filter(
    isMicrophoneGroundLine,
  )
  const contextGraphics: GraphicsObject = {
    ...fullGraphics,
    lines: [
      ...(outline.length > 0
        ? [
            {
              points: [...outline, outline[0]!],
              strokeColor: "rgba(71,85,105,0.18)",
              strokeWidth: 0.16,
              zIndex: -3,
            },
          ]
        : []),
      ...(fullGraphics.lines ?? [])
        .filter((line) => !isMicrophoneGroundLine(line))
        .map((line) => ({
          ...line,
          strokeColor: fadeColor(line.strokeColor, 0.94),
        })),
      ...contextConnectionLines.map((line) => ({
        ...line,
        strokeColor:
          (line.strokeWidth ?? srj.minTraceWidth) < srj.minTraceWidth
            ? "#dc2626"
            : "rgba(220,38,38,0.9)",
      })),
      ...violatingLines.map((line) => ({
        ...line,
        strokeColor: "rgba(220,38,38,0.2)",
        strokeWidth: Math.max((line.strokeWidth ?? 0) * 7, 0.56),
        zIndex: -1,
      })),

    ],
    rects: (fullGraphics.rects ?? []).map((rect) => {
      const isConnectionPad = rect.label?.includes("source_net_0")
      return {
        ...rect,
        fill: isConnectionPad
          ? "rgba(220,38,38,0.22)"
          : fadeColor(rect.fill, 0.94),
        stroke: isConnectionPad
          ? "rgba(220,38,38,0.5)"
          : fadeColor(rect.stroke, 0.94),
      }
    }),
    circles: [
      ...(fullGraphics.circles ?? []).map((circle) => ({
        ...circle,
        fill: fadeColor(circle.fill, 0.94),
        stroke: fadeColor(circle.stroke, 0.94),
      })),
      {
        center: { x: -16.0769, y: 2.4701 },
        radius: 1.25,
        fill: "rgba(255,255,255,0)",
        stroke: "#991b1b",
      },
    ],
    points: (fullGraphics.points ?? []).map((point) => ({
      ...point,
      color: point.label?.startsWith("source_net_0\n")
        ? "#dc2626"
        : fadeColor(point.color, 0.94),
    })),
    texts: [
      {
        x: 0,
        y: 40,
        text:
          actualMinimumWidth >= srj.minTraceWidth
            ? `This snapshot is good: trace width ${actualMinimumWidth.toFixed(4)} mm meets the minimum ${srj.minTraceWidth.toFixed(4)} mm.`
            : `This snapshot has insufficient trace width: ${actualMinimumWidth.toFixed(4)} mm is below the minimum ${srj.minTraceWidth.toFixed(4)} mm.`,
        fontSize: 1.05,
        color: "#0f172a",
        anchorSide: "center",
      },
    ],
  }

  await expect(
    getSvgFromGraphicsObject(contextGraphics, {
      backgroundColor: "white",
      svgWidth: 1000,
      svgHeight: 1100,
    }),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "microphone-terminal-width-context",
    tolerance: 0.03,
  })
}, 120_000)
