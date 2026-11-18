import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { getSvgFromGraphicsObject } from "/workspace/.tools/fanout2410-deps/node_modules/graphics-debug/dist/lib/index.js"
import { Resvg } from "/workspace/.tools/autorouter-dependencies/node_modules/@resvg/resvg-js/index.js"
const root = process.argv[2]
const trials = JSON.parse(readFileSync(`${root}/icepi/comparison.json`, "utf8"))
const bounds = { minX: -3.83, maxX: 6.34, minY: 9.48, maxY: 19.65 }
for (const phase of ["before", "after"]) {
  const graphics = JSON.parse(readFileSync(`${root}/icepi/trial-1/${phase}/fanout.graphics.json`, "utf8"))
  const report = JSON.parse(readFileSync(`${root}/icepi/trial-1/${phase}/report.json`, "utf8"))
  const times = trials.filter((trial) => trial.revision === phase).map((trial) => trial.elapsedMs).sort((first, second) => first - second)
  if (times.length !== 3) throw new Error("Expected three matched native timing pairs")
  for (const shape of ["rects", "circles", "points"]) {
    graphics[shape] = graphics[shape].filter((item) => {
      const point = item.center ?? item
      return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY
    }).map((item) => ({ ...item, label: undefined }))
  }
  graphics.rects.push({
    center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
    width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY,
    fill: "none", stroke: "#94a3b8", strokeWidth: 0.015,
  })
  graphics.texts = [
    { x: bounds.minX, y: bounds.maxY + 1.15, text: `${phase === "before" ? "Before" : "After"}: U22 native fanout median ${(times[1] / 1000).toFixed(1)} s`, fontSize: 0.32, color: "#0f172a", anchorSide: "center_left" },
    { x: bounds.minX, y: bounds.maxY + 0.65, text: `${report.bestPartial.routed}/32 partial escapes; ${report.copperDrc.checkedViaCount} vias; ${report.copperDrc.issues.length} copper DRC issues`, fontSize: 0.27, color: "#475569", anchorSide: "center_left" },
  ]
  writeFileSync(`${root}/icepi/${phase}.graphics.json`, JSON.stringify(graphics))
  const svg = getSvgFromGraphicsObject(graphics, { backgroundColor: "white", svgWidth: 1100, svgHeight: 1200 })
  writeFileSync(`${root}/icepi/${phase}.svg`, svg)
  writeFileSync(`${root}/icepi/${phase}.png`, new Resvg(svg, { fitTo: { mode: "width", value: 850 } }).render().asPng())
}
