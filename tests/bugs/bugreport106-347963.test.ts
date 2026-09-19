import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport106-347963/bugreport106-347963.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
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
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)

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
  const contextLines = focusedLines.filter(
    (line) => !isMicrophoneGroundLine(line),
  )
  const focusedGraphics: GraphicsObject = {
    lines: [
      ...contextLines.map((line) => ({
        ...line,
        strokeColor: fadeColor(line.strokeColor),
      })),
      ...connectionLines.map((line) => ({
        ...line,
        strokeColor:
          (line.strokeWidth ?? srj.minTraceWidth) < srj.minTraceWidth
            ? "#dc2626"
            : "rgba(220,38,38,0.55)",
      })),
      ...violatingLines.map((line) => ({
        ...line,
        strokeColor: "rgba(220,38,38,0.18)",
        strokeWidth: Math.max((line.strokeWidth ?? 0) * 4, 0.32),
        zIndex: -1,
      })),
    ],
    rects: [
      ...(fullGraphics.rects ?? [])
        .filter(
          (rect) =>
            rect.center.x + rect.width / 2 >= focusBounds.minX &&
            rect.center.x - rect.width / 2 <= focusBounds.maxX &&
            rect.center.y + rect.height / 2 >= focusBounds.minY &&
            rect.center.y - rect.height / 2 <= focusBounds.maxY,
        )
        .map((rect) => {
          const isConnectionPad = rect.label?.includes("source_net_0")
          return {
            ...rect,
            fill: isConnectionPad
              ? "rgba(220,38,38,0.18)"
              : fadeColor(rect.fill),
            stroke: isConnectionPad
              ? "rgba(220,38,38,0.35)"
              : fadeColor(rect.stroke),
          }
        }),
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
    circles: (fullGraphics.circles ?? [])
      .filter((circle) => isInsideFocus(circle.center))
      .map((circle) => ({
        ...circle,
        fill: fadeColor(circle.fill),
        stroke: fadeColor(circle.stroke),
      })),
    points: [],
    texts: [
      {
        x: (focusBounds.minX + focusBounds.maxX) / 2,
        y: 3.28,
        text: `CURRENT ${actualMinimumWidth.toFixed(4)} mm  •  EXPECTED MINIMUM ${srj.minTraceWidth.toFixed(4)} mm`,
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
}, 60_000)
