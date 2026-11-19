import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const { getSvgFromGraphicsObject } = await import(resolve(process.argv[2], "graphics-debug/dist/lib/index.js"))
const root = import.meta.dir
const bounds = { minX: -3.83, maxX: 6.34, minY: 9.48, maxY: 19.65 }
for (const phase of ["before", "after"]) {
  const folder = `${root}/paired/icepi/trial-1/${phase}`
  const graphics = JSON.parse(readFileSync(`${folder}/fanout.graphics.json`, "utf8"))
  const report = JSON.parse(readFileSync(`${folder}/report.json`, "utf8"))
  for (const kind of ["rects", "circles", "points"]) {
    graphics[kind] = graphics[kind].filter((item) => {
      const point = item.center ?? item
      return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY
    }).map((item) => ({ ...item, label: undefined }))
  }
  graphics.rects.push({ center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY, fill: "none", stroke: "#94a3b8", strokeWidth: 0.015 })
  graphics.texts = [
    { x: bounds.minX, y: bounds.maxY + 1.15, text: `${phase === "before" ? "Before" : "After"}: U22 joint partial ${report.bestPartial.routed}/32 escapes`, fontSize: 0.32, color: "#0f172a", anchorSide: "center_left" },
    { x: bounds.minX, y: bounds.maxY + 0.65, text: `${report.copperDrc.checkedViaCount} vias; ${report.copperDrc.issues.length} independent copper DRC issues`, fontSize: 0.27, color: "#475569", anchorSide: "center_left" },
    { x: bounds.minX, y: bounds.maxY + 0.22, text: "Uncommitted: the complete 32-connection region still fails", fontSize: 0.22, color: "#475569", anchorSide: "center_left" },
  ]
  writeFileSync(`${root}/paired/icepi/${phase}.graphics.json`, JSON.stringify(graphics))
  writeFileSync(`${root}/paired/icepi/${phase}.svg`, getSvgFromGraphicsObject(graphics, { backgroundColor: "white", svgWidth: 1100, svgHeight: 1200 }))
}
