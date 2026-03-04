import type { GraphicsObject } from "graphics-debug"

/**
 * Adds a visualization to the last step of a base visualization
 * @param baseVisualization The base visualization with steps
 * @param visualizationToAdd The visualization to add to the last step
 * @returns A combined visualization with the added visualization at the last step
 */
export const addVisualizationToLastStep = (
  baseVisualization: GraphicsObject,
  visualizationToAdd: GraphicsObject,
): GraphicsObject => {
  // Find the highest step in the base visualization
  let highestStep = -1

  // Check each visualization array type for the highest step
  const checkArrayForHighestStep = (arr: any[] | undefined) => {
    if (!arr || arr.length === 0) return
    arr.forEach((item) => {
      if (item.step !== undefined && item.step > highestStep) {
        highestStep = item.step
      }
    })
  }

  checkArrayForHighestStep(baseVisualization.points)
  checkArrayForHighestStep(baseVisualization.lines)
  checkArrayForHighestStep(baseVisualization.circles)
  checkArrayForHighestStep(baseVisualization.rects)

  // If no steps found, default to 0
  if (highestStep === -1) {
    highestStep = 0
  }

  // Create a new visualization with the added items at the highest step
  const result: GraphicsObject = {
    points: [...(baseVisualization.points || [])],
    lines: [...(baseVisualization.lines || [])],
    circles: [...(baseVisualization.circles || [])],
    rects: [...(baseVisualization.rects || [])],
  }

  // Add each item from visualizationToAdd with the highest step
  if (visualizationToAdd.points) {
    result.points = [
      ...(result.points || []),
      ...visualizationToAdd.points.map((p) => ({ ...p, step: highestStep })),
    ]
  }

  if (visualizationToAdd.lines) {
    result.lines = [
      ...(result.lines || []),
      ...visualizationToAdd.lines.map((l) => ({ ...l, step: highestStep })),
    ]
  }

  if (visualizationToAdd.circles) {
    result.circles = [
      ...(result.circles || []),
      ...visualizationToAdd.circles.map((c) => ({ ...c, step: highestStep })),
    ]
  }

  if (visualizationToAdd.rects) {
    result.rects = [
      ...(result.rects || []),
      ...visualizationToAdd.rects.map((r) => ({ ...r, step: highestStep })),
    ]
  }

  return result
}
