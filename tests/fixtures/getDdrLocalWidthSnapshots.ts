import { getBoundsFromPoints } from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { type GraphicsObject, getSvgFromGraphicsObject } from "graphics-debug"
import {
  TraceWidthSolver,
  type TraceWidthSolverInput,
} from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

type DdrWidthCapture = {
  input: TraceWidthSolverInput
  netMap: ConnectivityMap["netMap"]
  idToNetMap: ConnectivityMap["idToNetMap"]
  refinement: Parameters<TraceWidthSolver["refineWidths"]>[0] & {
    board: SimpleRouteJson
  }
  background: GraphicsObject
  names: Record<string, string>
}

type TraceWidthDrawing = {
  lines: NonNullable<GraphicsObject["lines"]>
  totalMm: number
  nominalMm: number
}

function drawTraceWidths(
  routes: HighDensityRoute[],
  nominalWidths: Map<string, number>,
): TraceWidthDrawing {
  const drawing: TraceWidthDrawing = { lines: [], totalMm: 0, nominalMm: 0 }
  for (const route of routes) {
    const nominalWidth =
      nominalWidths.get(route.connectionName) ??
      nominalWidths.get(route.rootConnectionName ?? route.connectionName)
    if (nominalWidth === undefined) {
      throw new Error(`Missing requested width for ${route.connectionName}`)
    }

    for (let index = 1; index < route.route.length; index++) {
      const start = route.route[index - 1]!
      const end = route.route[index]!
      if (start.z !== end.z || start.toNextSegmentType === "through_obstacle") {
        continue
      }
      const length = Math.hypot(end.x - start.x, end.y - start.y)
      if (length === 0) continue
      const width = start.traceThickness ?? route.traceThickness
      const isAtNominalWidth = width >= nominalWidth
      drawing.lines.push({
        points: [start, end],
        strokeWidth: width,
        strokeColor: isAtNominalWidth ? "#087766" : "#b45309",
      })
      drawing.totalMm += length
      if (isAtNominalWidth) drawing.nominalMm += length
    }
  }
  return drawing
}

function renderWidthDrawing({
  drawing,
  background,
  bounds,
  title,
}: {
  drawing: TraceWidthDrawing
  background: GraphicsObject
  bounds: SimpleRouteJson["bounds"]
  title: string
}): string {
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
  const labels = [
    { text: title, y: 0.095, size: 0.031 },
    {
      text: `${drawing.nominalMm.toFixed(2)} of ${drawing.totalMm.toFixed(2)} mm at requested width`,
      y: 0.052,
      size: 0.022,
    },
    { text: "Teal at requested width · amber below", y: 0.018, size: 0.017 },
  ]
  return getSvgFromGraphicsObject(
    {
      ...background,
      coordinateSystem: "cartesian",
      lines: [...(background.lines ?? []), ...drawing.lines],
      texts: labels.map(({ text, y, size }) => ({
        text,
        x: bounds.minX,
        y: bounds.maxY + span * y,
        fontSize: span * size,
        anchorSide: "center_left",
      })),
    },
    {
      backgroundColor: "white",
      includeTextLabels: false,
      svgWidth: 900,
      svgHeight: 720,
    },
  )
}

export function getDdrLocalWidthSnapshots(
  board: "glider" | "orangecrab",
  connectionName: string,
): {
  boardSvg: string
  traceSvg: string
  traceNominalMm: number
  traceLengthMm: number
} {
  const file = new URL(
    `./assets/ddr-local-trace-widths/${board}.json.gz`,
    import.meta.url,
  )
  const capture: DdrWidthCapture = JSON.parse(
    gunzipSync(Uint8Array.from(readFileSync(file))).toString("utf8"),
  )
  const connMap = new ConnectivityMap(capture.netMap)
  connMap.idToNetMap = capture.idToNetMap
  const solver = new TraceWidthSolver({ ...capture.input, connMap })
  solver.solve()
  const routes = solver.refineWidths(capture.refinement)
  const selected = routes.filter(
    (route) =>
      route.connectionName === connectionName ||
      route.rootConnectionName === connectionName,
  )
  const bounds = getBoundsFromPoints(selected.flatMap((route) => route.route))
  if (!bounds) throw new Error(`Missing captured connection ${connectionName}`)

  const name = board === "glider" ? "Glider" : "OrangeCrab"
  const widths = solver.connectionNominalTraceWidthMap
  const trace = drawTraceWidths(selected, widths)
  const circles = selected.flatMap((route) =>
    route.vias.map((center) => ({
      center,
      radius: route.viaDiameter / 2,
      fill: "#64748b",
    })),
  )
  return {
    boardSvg: renderWidthDrawing({
      drawing: drawTraceWidths(routes, widths),
      background: capture.background,
      bounds: capture.refinement.board.bounds,
      title: `${name} DDR · remaining-phase copper`,
    }),
    traceSvg: renderWidthDrawing({
      drawing: trace,
      background: { circles },
      bounds,
      title: `${name} · ${capture.names[connectionName]}`,
    }),
    traceNominalMm: trace.nominalMm,
    traceLengthMm: trace.totalMm,
  }
}
