import type { GraphicsObject } from "graphics-debug"

export const limitVisualizations = (
  graphicsObject: GraphicsObject,
  objectLimit = 10000,
): GraphicsObject => {
  // Count total objects
  const totalObjects =
    (graphicsObject.points?.length || 0) +
    (graphicsObject.lines?.length || 0) +
    (graphicsObject.circles?.length || 0) +
    (graphicsObject.rects?.length || 0)

  // If under limit, return original
  if (totalObjects <= objectLimit) {
    return graphicsObject
  }

  // Calculate skip factor (percentage of objects to skip)
  // totalObjects objectLimit skipFactor
  // 1            1000        -999 / 1 = -999
  // 10e3         1000        9000 / 10e3 = 0.9
  const skipFactor = (totalObjects - objectLimit) / totalObjects

  // Filter function that keeps objects based on skipFactor
  const filterBySkipFactor = (_: any, index: number) => {
    return (index * 37717) % 1000 > skipFactor * 1000
  }

  // Create new graphics object with reduced items
  const reduced: GraphicsObject = {
    points: graphicsObject.points
      ? graphicsObject.points.filter(filterBySkipFactor)
      : [],
    lines: graphicsObject.lines
      ? graphicsObject.lines.filter(filterBySkipFactor)
      : [],
    circles: graphicsObject.circles
      ? graphicsObject.circles.filter(filterBySkipFactor)
      : [],
    rects: graphicsObject.rects
      ? graphicsObject.rects.filter(filterBySkipFactor)
      : [],
  }

  return reduced
}
