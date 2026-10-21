import "./svg-matcher"
import { expect } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import {
  getSvgFromGraphicsObject,
  type GraphicsObject,
  type Point,
} from "graphics-debug"

export type PerformanceGraphic = GraphicsObject &
  Required<
    Pick<GraphicsObject, "rects" | "lines" | "circles" | "texts" | "arrows">
  >

export const beforeColor = "#b45309"
export const afterColor = "#047857"

export function visualText(
  graphics: PerformanceGraphic,
  x: number,
  y: number,
  text: string,
  fontSize = 16,
  color = "#172033",
): void {
  graphics.texts.push({
    x,
    y,
    text,
    fontSize,
    color,
    anchorSide: "center_left",
  })
}

export function performanceCanvas(
  title: string,
  subtitle: string,
): PerformanceGraphic {
  const graphics: PerformanceGraphic = {
    coordinateSystem: "screen",
    rects: [
      {
        center: { x: 600, y: 350 },
        width: 1200,
        height: 700,
        fill: "transparent",
        stroke: "none",
      },
    ],
    lines: [],
    circles: [],
    texts: [],
    arrows: [],
  }
  visualText(graphics, 32, 38, title, 28)
  visualText(graphics, 32, 72, subtitle, 16, "#475569")
  return graphics
}

export function visualPanel(
  graphics: PerformanceGraphic,
  left: number,
  title: string,
  subtitle: string,
  color: string,
): void {
  graphics.rects.push({
    center: { x: left + 276, y: 308 },
    width: 552,
    height: 412,
    fill: "transparent",
    stroke: "#cbd5e1",
  })
  visualText(graphics, left + 20, 130, title, 22, color)
  visualText(graphics, left + 20, 158, subtitle, 14, "#475569")
}

export function visualMetric(
  graphics: PerformanceGraphic,
  label: string,
  before: number,
  after: number,
  preserved: string,
): void {
  const maximum = Math.max(before, after, 1)
  visualText(graphics, 32, 552, label, 20)
  for (const [left, value, prefix, color] of [
    [48, before, "Before", beforeColor],
    [648, after, "After", afterColor],
  ] as const) {
    const width = (value / maximum) * 440
    visualText(
      graphics,
      left,
      584,
      `${prefix}: ${value.toLocaleString("en-US")}`,
      23,
      color,
    )
    graphics.rects.push({
      center: { x: left + width / 2, y: 616 },
      width,
      height: 18,
      fill: color,
      stroke: "none",
    })
  }
  visualText(graphics, 32, 659, preserved, 15, afterColor)
  visualText(
    graphics,
    32,
    683,
    "Generated from live test observations. Shared bar scale; counts are not elapsed-time measurements.",
    13,
    "#64748b",
  )
}

export function projectVisual(
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  left: number,
  top: number,
  width: number,
  height: number,
): (point: Point) => Point {
  const scale = Math.min(
    width / (bounds.maxX - bounds.minX),
    height / (bounds.maxY - bounds.minY),
  )
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  return (point: Point): Point => {
    const distanceX = point.x - centerX
    const distanceY = point.y - centerY
    const x = left + width / 2 + distanceX * scale
    const y = top + height / 2 - distanceY * scale
    return { x, y }
  }
}

export async function expectPerformanceSvg(
  graphics: PerformanceGraphic,
  testPath: string,
): Promise<void> {
  const svg = getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white",
    svgWidth: 1200,
    svgHeight: 700,
  }).replace(/[ \t]+$/gm, "")
  const name = basename(testPath).replace(/\.test\.tsx?$/, "")
  const snapshotPath = join(
    dirname(testPath),
    "__snapshots__",
    `${name}-visual.snap.svg`,
  )
  const existing = existsSync(snapshotPath)
    ? await readFile(snapshotPath, "utf8")
    : undefined
  // Byte-identical SVGs render identically. This stricter equality avoids
  // rasterizing two identical dense diagrams; changed SVGs still use the
  // existing visual matcher and its normal snapshot-update behavior.
  if (existing === svg) expect(svg).toBe(existing)
  else await expect(svg).toMatchSvgSnapshot(testPath, { svgName: "visual" })
  const exportDirectory = process.env.PERFORMANCE_SNAPSHOT_EXPORT_DIR
  if (exportDirectory) {
    await mkdir(exportDirectory, { recursive: true })
    await writeFile(
      join(exportDirectory, `${name}.graphics.json`),
      JSON.stringify(graphics),
    )
  }
}
