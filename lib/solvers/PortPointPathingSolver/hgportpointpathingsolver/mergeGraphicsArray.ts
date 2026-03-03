import { mergeGraphics, type GraphicsObject } from "graphics-debug"

/** Merges multiple debug graphics payloads into a single object. */
export function mergeGraphicsArray(
  graphicsObjects: (GraphicsObject | null | undefined)[],
): GraphicsObject {
  let merged: GraphicsObject | undefined | null = {}
  merged = graphicsObjects.reduce((acc, obj) => {
    if (!acc || !obj) {
      return {}
    }
    return mergeGraphics(acc, obj)
  }, merged)
  if (!merged) {
    return {}
  }
  return merged
}
