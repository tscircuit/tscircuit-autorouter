import { getSvgFromGraphicsObject } from "/workspace/.tools/fanout2410-deps/node_modules/graphics-debug/dist/lib/index.js"
import { readFileSync, writeFileSync } from "node:fs"

const root = import.meta.dir
const bounds = { minX: -3.83, maxX: 6.34, minY: 9.48, maxY: 19.65 }
for (const phase of ["before", "after"]) {
  const graphics = JSON.parse(readFileSync(`${root}/native/${phase}/fanout.graphics.json`, "utf8"))
  const report = JSON.parse(readFileSync(`${root}/native/${phase}/report.json`, "utf8"))
  const routed = Number(report.error.match(/routed (\d+)\//)[1])
  const remainingNames = new Set(graphics.points.map((point) => point.label.split("\n")[0]))
  const completedPlanes = report.options.buses.filter((bus) =>
    bus.termination.type === "plane" && bus.connectionNames.every((name) => !remainingNames.has(name)),
  ).length
  const vias = graphics.circles.filter((circle) =>
    circle.fill === "blue" && circle.label === undefined,
  ).length
  for (const shape of ["rects", "circles", "points"]) {
    graphics[shape] = graphics[shape].filter((item) => {
      const point = item.center ?? item
      return point.x >= bounds.minX && point.x <= bounds.maxX &&
        point.y >= bounds.minY && point.y <= bounds.maxY
    }).map((item) => ({ ...item, label: undefined }))
  }
  graphics.rects.push({
    center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
    width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY,
    fill: "none", stroke: "#94a3b8", strokeWidth: 0.015,
  })
  graphics.texts = [
    { x: bounds.minX, y: bounds.maxY + 1.15, text: `${phase === "before" ? "Before" : "After"}: U22 best partial fanout ${routed}/32`, fontSize: 0.34, color: "#0f172a", anchorSide: "center_left" },
    { x: bounds.minX, y: bounds.maxY + 0.65, text: `${completedPlanes}/20 local plane drops; ${vias} vias; full fanout still fails`, fontSize: 0.27, color: "#475569", anchorSide: "center_left" },
  ]
  writeFileSync(`${root}/native/${phase}/u22-cut.graphics.json`, JSON.stringify(graphics))
  writeFileSync(`${root}/native/${phase}/u22-cut.svg`, getSvgFromGraphicsObject(graphics, { backgroundColor: "white", svgWidth: 1100, svgHeight: 1200 }))
  writeFileSync(`${root}/native/${phase}/visual-summary.json`, JSON.stringify({
    routed, requested: report.inputConnections, completedPlanes, planeRequests: report.options.buses.length,
    vias, acceptedByCore: false, bounds, originalGraphics: "fanout.graphics.json",
    notes: "Native visualize() renders bestAttempt.outputSrj. Plane connections are removed from that output after successful local termination. Via circles are native trace via glyphs; pads retain label metadata in the original graphics. Only the drawing is cropped; routing input is unchanged.",
  }, null, 2))
}
