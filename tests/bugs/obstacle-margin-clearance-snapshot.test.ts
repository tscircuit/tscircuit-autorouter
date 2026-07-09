import { expect, test } from "bun:test"
import bugReportJson from "fixtures/bug-reports/bugreport01-be84eb/bugreport01-be84eb.json" with {
  type: "json",
}
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { SimpleRouteJson } from "lib/types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

type WireSegment = {
  conn: string
  layer: string
  width: number
  start: { x: number; y: number }
  end: { x: number; y: number }
}

type ClearanceMeasurement = {
  margin: number
  minGap: number
  segmentA: WireSegment
  segmentB: WireSegment
}

const baseSrj = bugReportJson.simple_route_json as SimpleRouteJson
const margins = [0, 0.1, 0.2, 0.3]

test("snapshot of non-monotonic produced clearance vs defaultObstacleMargin", async () => {
  const measurements = margins.map(measureMinClearanceForMargin)

  await expect(renderClearanceSnapshot(measurements)).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "obstacle-margin-clearance" },
  )
}, 15_000)

function measureMinClearanceForMargin(margin: number): ClearanceMeasurement {
  const srj = structuredClone(baseSrj) as SimpleRouteJson & {
    defaultObstacleMargin?: number
  }
  srj.defaultObstacleMargin = margin

  const solver = new AutoroutingPipelineSolver4(srj)
  solver.solve()

  const traces = solver.getOutputSimplifiedPcbTraces()
  const wireSegments: WireSegment[] = []

  for (const trace of traces) {
    for (let i = 0; i < trace.route.length - 1; i++) {
      const start = trace.route[i]
      const end = trace.route[i + 1]

      if (start.route_type !== "wire" || end.route_type !== "wire") continue
      if (start.layer !== end.layer) continue

      wireSegments.push({
        conn: trace.connection_name,
        layer: start.layer,
        width: start.width,
        start: { x: start.x, y: start.y },
        end: { x: end.x, y: end.y },
      })
    }
  }

  let best: ClearanceMeasurement | null = null

  for (let i = 0; i < wireSegments.length; i++) {
    for (let j = i + 1; j < wireSegments.length; j++) {
      const segmentA = wireSegments[i]
      const segmentB = wireSegments[j]

      if (segmentA.conn === segmentB.conn) continue
      if (segmentA.layer !== segmentB.layer) continue

      const minGap =
        minimumDistanceBetweenSegments(
          segmentA.start,
          segmentA.end,
          segmentB.start,
          segmentB.end,
        ) -
        (segmentA.width + segmentB.width) / 2

      if (!best || minGap < best.minGap) {
        best = { margin, minGap, segmentA, segmentB }
      }
    }
  }

  if (!best) {
    throw new Error(
      `No different-net same-layer wire gaps for margin ${margin}`,
    )
  }

  return best
}

function renderClearanceSnapshot(measurements: ClearanceMeasurement[]): string {
  const width = 980
  const height = 600
  const chartX = 90
  const chartY = 150
  const chartWidth = 760
  const chartHeight = 230
  const maxGap = 0.32
  const baseline = chartY + chartHeight
  const firstGap = measurements[0]!.minGap
  const rows = measurements.map((measurement, index) => {
    const barWidth = 84
    const gap = 120
    const x = chartX + index * (barWidth + gap)
    const barHeight = (measurement.minGap / maxGap) * chartHeight
    const y = baseline - barHeight
    const isRegression = measurement.minGap < firstGap
    const fill = isRegression ? "#f97316" : "#2563eb"
    const labelY = baseline + 36
    const valueY = y - 14

    return `
      <g>
        <rect x="${x}" y="${y.toFixed(2)}" width="${barWidth}" height="${barHeight.toFixed(2)}" rx="8" fill="${fill}" />
        <text x="${x + barWidth / 2}" y="${valueY.toFixed(2)}" text-anchor="middle" class="value">${formatMm(measurement.minGap)}</text>
        <text x="${x + barWidth / 2}" y="${labelY}" text-anchor="middle" class="axis">margin ${formatMargin(measurement.margin)}</text>
      </g>`
  })

  const linePoints = measurements
    .map((measurement, index) => {
      const barWidth = 84
      const gap = 120
      const x = chartX + index * (barWidth + gap) + barWidth / 2
      const y = baseline - (measurement.minGap / maxGap) * chartHeight
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(" ")

  const details = measurements
    .map(
      (measurement, index) =>
        `<text x="90" y="${470 + index * 24}" class="detail">defaultObstacleMargin=${formatMargin(measurement.margin)} -> min gap ${formatMm(measurement.minGap)} between ${escapeXml(measurement.segmentA.conn)} and ${escapeXml(measurement.segmentB.conn)} on ${escapeXml(measurement.segmentA.layer)}</text>`,
    )
    .join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .title { font: 700 28px Arial, sans-serif; fill: #111827; }
    .subtitle { font: 18px Arial, sans-serif; fill: #374151; }
    .axis { font: 15px Arial, sans-serif; fill: #4b5563; }
    .value { font: 700 18px Arial, sans-serif; fill: #111827; }
    .detail { font: 15px Consolas, monospace; fill: #111827; }
    .note { font: 700 17px Arial, sans-serif; fill: #b45309; }
  </style>
  <rect width="${width}" height="${height}" fill="#f8fafc" />
  <text x="48" y="56" class="title">Autorouter obstacle margin clearance snapshot</text>
  <text x="48" y="91" class="subtitle">Expected: produced different-net clearance grows as defaultObstacleMargin increases.</text>
  <text x="48" y="120" class="note">Bug: margin 0.2 produces ${formatMm(measurements[2]!.minGap)}, smaller than margin 0 at ${formatMm(firstGap)}.</text>
  <line x1="${chartX}" y1="${baseline}" x2="${chartX + chartWidth}" y2="${baseline}" stroke="#94a3b8" stroke-width="2" />
  <line x1="${chartX}" y1="${chartY}" x2="${chartX}" y2="${baseline}" stroke="#94a3b8" stroke-width="2" />
  <text x="30" y="${chartY + 8}" class="axis">0.32mm</text>
  <text x="42" y="${baseline}" class="axis">0mm</text>
  <polyline points="${linePoints}" fill="none" stroke="#0f172a" stroke-width="3" stroke-linejoin="round" />
  ${rows.join("\n")}
  ${details}
</svg>`
}

function formatMm(value: number): string {
  return `${value.toFixed(4)}mm`
}

function formatMargin(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "")
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}
