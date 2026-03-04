import type { GraphicsObject } from "graphics-debug"

export const combineVisualizations = (
  ...visualizations: GraphicsObject[]
): GraphicsObject => {
  const combined: GraphicsObject = {
    points: [],
    lines: [],
    circles: [],
    rects: [],
  }

  visualizations.forEach((viz, i) => {
    if (!viz) return
    if (viz.lines) {
      combined.lines = [
        ...(combined.lines || []),
        ...viz.lines.map((l) => ({ ...l, step: i })),
      ]
    }
    if (viz.points) {
      combined.points = [
        ...(combined.points || []),
        ...viz.points.map((p) => ({ ...p, step: i })),
      ]
    }
    if (viz.circles) {
      combined.circles = [
        ...(combined.circles || []),
        ...viz.circles.map((c) => ({ ...c, step: i })),
      ]
    }
    if (viz.rects) {
      combined.rects = [
        ...(combined.rects || []),
        ...viz.rects.map((r) => ({ ...r, step: i })),
      ]
    }
  })

  return combined
}
