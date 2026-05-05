import type { GraphicsObject } from "graphics-debug"
import { parseToRgb } from "polished"
import { safeTransparentize } from "lib/solvers/colors"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

const setColorOpacity = (color: string | undefined, opacity: number) => {
  if (!color || color === "none") return color

  try {
    const parsedColor = parseToRgb(color)
    return `rgba(${parsedColor.red},${parsedColor.green},${parsedColor.blue},${opacity})`
  } catch {
    return safeTransparentize(color, 1 - opacity)
  }
}

export const getPresuppliedTraceVisualization = (
  srj: SimpleRouteJson,
  opacity = 0.25,
): GraphicsObject => {
  const traceVisualization = convertSrjToGraphicsObject({
    ...srj,
    obstacles: [],
  })

  return {
    ...traceVisualization,
    points: [],
    lines: traceVisualization.lines?.map((line) => ({
      ...line,
      strokeColor: setColorOpacity(line.strokeColor, opacity),
    })),
    rects: traceVisualization.rects?.map((rect) => ({
      ...rect,
      fill: setColorOpacity(rect.fill, opacity),
      stroke: setColorOpacity(rect.stroke, opacity),
    })),
    circles: traceVisualization.circles?.map((circle) => ({
      ...circle,
      fill: setColorOpacity(circle.fill, opacity),
      stroke: setColorOpacity(circle.stroke, opacity),
    })),
  }
}
