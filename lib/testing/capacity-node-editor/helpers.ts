import type { Edge, Rect } from "./types"

export function getPointOnEdge(edge: Edge, t: number, rect: Rect) {
  const { x, y, width, height } = rect
  switch (edge) {
    case "top":
      return { x: x + t * width, y }
    case "bottom":
      return { x: x + t * width, y: y + height }
    case "left":
      return { x, y: y + t * height }
    case "right":
      return { x: x + width, y: y + t * height }
    default:
      return { x: 0, y: 0 }
  }
}

export function getTFromMouseOnEdge(
  mx: number,
  my: number,
  edge: Edge,
  rect: Rect,
) {
  const { x, y, width, height } = rect
  let t = 0.5
  switch (edge) {
    case "top":
    case "bottom":
      t = (mx - x) / width
      break
    case "left":
    case "right":
      t = (my - y) / height
      break
  }
  return Math.max(0.05, Math.min(0.95, t))
}

export function findEdgeAndT(
  px: number,
  py: number,
  rect: Rect,
): { edge: Edge; t: number } | null {
  const { x, y, width, height } = rect
  const threshold = 15
  if (Math.abs(py - y) < threshold && px >= x && px <= x + width)
    return { edge: "top", t: Math.max(0.05, Math.min(0.95, (px - x) / width)) }
  if (Math.abs(py - (y + height)) < threshold && px >= x && px <= x + width)
    return {
      edge: "bottom",
      t: Math.max(0.05, Math.min(0.95, (px - x) / width)),
    }
  if (Math.abs(px - x) < threshold && py >= y && py <= y + height)
    return {
      edge: "left",
      t: Math.max(0.05, Math.min(0.95, (py - y) / height)),
    }
  if (Math.abs(px - (x + width)) < threshold && py >= y && py <= y + height)
    return {
      edge: "right",
      t: Math.max(0.05, Math.min(0.95, (py - y) / height)),
    }
  return null
}

export function parseLayers(str: string): number[] {
  return str
    .split(",")
    .map((s) => parseInt(s.trim()))
    .filter((n) => !isNaN(n) && n >= 0 && n <= 3)
}
