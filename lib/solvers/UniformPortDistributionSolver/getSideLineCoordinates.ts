import { Bounds, Side } from "./types"

export const getSideLineCoordinates = ({
  bounds,
  side,
}: {
  bounds: Bounds
  side: Side
}): { x1: number; y1: number; x2: number; y2: number } => {
  if (side === "top") {
    return {
      x1: bounds.minX,
      y1: bounds.maxY,
      x2: bounds.maxX,
      y2: bounds.maxY,
    }
  }
  if (side === "bottom") {
    return {
      x1: bounds.minX,
      y1: bounds.minY,
      x2: bounds.maxX,
      y2: bounds.minY,
    }
  }
  if (side === "left") {
    return {
      x1: bounds.minX,
      y1: bounds.minY,
      x2: bounds.minX,
      y2: bounds.maxY,
    }
  }
  return { x1: bounds.maxX, y1: bounds.minY, x2: bounds.maxX, y2: bounds.maxY }
}
