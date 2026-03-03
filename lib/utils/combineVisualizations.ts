import type { GraphicsObject } from "graphics-debug"

type FilledPolygon = {
  points: { x: number; y: number }[]
  fill?: string
  stroke?: string
  strokeWidth?: number
  step?: number
  label?: string
}

type ExtendedGraphicsObject = GraphicsObject & {
  polygons?: FilledPolygon[]
}

export const combineVisualizations = (
  ...visualizations: ExtendedGraphicsObject[]
): ExtendedGraphicsObject => {
  const combined: ExtendedGraphicsObject = {
    points: [],
    lines: [],
    circles: [],
    rects: [],
    polygons: [],
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
    if (viz.polygons) {
      combined.polygons = [
        ...(combined.polygons || []),
        ...viz.polygons.map((p) => ({ ...p, step: i })),
      ]
    }
  })

  return combined
}
