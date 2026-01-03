import type { GraphicsObject, Line, Rect } from "graphics-debug"
import type { Jumper } from "../types/high-density-types"
import { safeTransparentize } from "../solvers/colors"
import { JUMPER_DIMENSIONS } from "./jumperSizes"

export interface JumperGraphicsOptions {
  color?: string
  label?: string
}

/**
 * Generates graphics-debug rects and lines for visualizing a jumper component.
 * Returns the pads (rects) and body line for a jumper.
 */
export function getJumperGraphics(
  jumper: Jumper,
  options: JumperGraphicsOptions = {},
): { rects: Rect[]; lines: Line[] } {
  const rects: Rect[] = []
  const lines: Line[] = []
  const color = options.color ?? "gray"
  const label = options.label

  const dims = JUMPER_DIMENSIONS[jumper.footprint] ?? JUMPER_DIMENSIONS["0603"]

  // Determine jumper orientation to rotate pad dimensions
  const dx = jumper.end.x - jumper.start.x
  const dy = jumper.end.y - jumper.start.y
  const isHorizontal = Math.abs(dx) > Math.abs(dy)
  const rectWidth = isHorizontal ? dims.padLength : dims.padWidth
  const rectHeight = isHorizontal ? dims.padWidth : dims.padLength

  // Draw start pad
  rects.push({
    center: jumper.start,
    width: rectWidth,
    height: rectHeight,
    fill: safeTransparentize(color, 0.5),
    stroke: "rgba(0, 0, 0, 0.5)",
    layer: "jumper",
    label: label ? `${label} (start)` : undefined,
  })

  // Draw end pad
  rects.push({
    center: jumper.end,
    width: rectWidth,
    height: rectHeight,
    fill: safeTransparentize(color, 0.5),
    stroke: "rgba(0, 0, 0, 0.5)",
    layer: "jumper",
    label: label ? `${label} (end)` : undefined,
  })

  // Draw connecting line (jumper body)
  lines.push({
    points: [jumper.start, jumper.end],
    strokeColor: "rgba(100, 100, 100, 0.8)",
    strokeWidth: dims.padWidth * 0.3,
    layer: "jumper-body",
  })

  return { rects, lines }
}

/**
 * Generates graphics objects for an array of jumpers.
 * Combines all rects and lines into a single GraphicsObject.
 */
export function getJumpersGraphics(
  jumpers: Jumper[],
  options: JumperGraphicsOptions = {},
): GraphicsObject {
  const graphics: GraphicsObject = {
    rects: [],
    lines: [],
  }

  for (const jumper of jumpers) {
    const { rects, lines } = getJumperGraphics(jumper, options)
    graphics.rects!.push(...rects)
    graphics.lines!.push(...lines)
  }

  return graphics
}
