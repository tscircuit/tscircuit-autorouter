import { readFileSync, writeFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { resolve, join } from "node:path"
const fanout = resolve("core/node_modules/@tscircuit/fanout-solver/lib")
const { visualizeSimpleRouteJson } = await import(join(fanout, "visualize-simple-route-json.ts"))
const { getSvgFromGraphicsObject } = await import(resolve("core/node_modules/graphics-debug"))
for (const [sample, sourceLabel] of [["icepi-original", "U22.BALL_B5"], ["imx6-original", "U10.BALL_B2"]]) {
  const capture = join("captures", "full-circuit-interception-" + sample, sample)
  const diagnosis = JSON.parse(readFileSync(join("diagnoses", "full-circuit-diagnosis-" + sample, "analysis.json"), "utf8"))
  const row = diagnosis.fanout[0].rejections.find((entry: any) => entry.label === sourceLabel && entry.reason === "pad-trace")
  if (!row) throw new Error(`No original rejection captured for ${sourceLabel}`)
  const records = JSON.parse(gunzipSync(new Uint8Array(readFileSync(join(capture, "fanout-rejection-examples.json.gz")))).toString())
  const rejection = records.find(([key]: [string]) => key === row.key)[1]
  const original = JSON.parse(gunzipSync(new Uint8Array(readFileSync(join(capture, `solver-${diagnosis.fanout[0].solverId}-input.json.gz`)))).toString())[0]
  const { segment, obstacle, plan } = rejection
  const margin = 0.8
  const bounds = {
    minX: Math.min(segment.start.x, segment.end.x, obstacle.center.x) - margin,
    maxX: Math.max(segment.start.x, segment.end.x, obstacle.center.x) + margin,
    minY: Math.min(segment.start.y, segment.end.y, obstacle.center.y) - margin,
    maxY: Math.max(segment.start.y, segment.end.y, obstacle.center.y) + margin,
  }
  // Visualization-only crop. Every shown pad and the rejected segment retain
  // their original board-world coordinates, layer and copper width in mm.
  const graphics = visualizeSimpleRouteJson({
    ...original,
    bounds,
    connections: [],
    obstacles: original.obstacles.filter((pad: any) => !pad.isCopperPour && pad.layers.includes(segment.layer) && pad.center.x + pad.width / 2 >= bounds.minX && pad.center.x - pad.width / 2 <= bounds.maxX && pad.center.y + pad.height / 2 >= bounds.minY && pad.center.y - pad.height / 2 <= bounds.maxY),
    traces: [{ ...plan.trace, route: [segment.start, segment.end].map((point: any) => ({ route_type: "wire", x: point.x, y: point.y, layer: segment.layer, width: segment.width })) }],
  })
  const pinLabel = sourceLabel.replace(".BALL_", ".")
  const blocker = row.blocker.split(",")[0].replace(".BALL_", ".")
  graphics.title = `${sample}: rejected candidate segment, not routed copper`
  graphics.points = [{ ...plan.sourcePoint, label: pinLabel, color: "#111827" }, { ...obstacle.center, label: blocker, color: "#111827" }]
  graphics.texts = [{ x: bounds.minX, y: bounds.maxY + 0.1, text: `Rejected: ${row.gapMm.toFixed(3)}mm gap; ${row.requiredClearanceMm}mm required`, color: "#111827", fontSize: 0.09, anchorSide: "bottom_left" }]
  const target = join("experiments/e2e-samples-20261120/interception-results", sample, "rejected-source-segment.svg")
  writeFileSync(target, getSvgFromGraphicsObject(graphics, { backgroundColor: "white", svgWidth: 1000, svgHeight: 850 }))
}
