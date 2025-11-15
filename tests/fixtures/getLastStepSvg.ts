import { getSvgFromGraphicsObject } from "graphics-debug"
import type { GraphicsObject } from "graphics-debug"

export function getLastStepSvg(graphicsObject: GraphicsObject) {
  // Find the maximum step value across all elements
  const allSteps = [
    ...(graphicsObject.lines?.map((l: any) => l.step) ?? []),
    ...(graphicsObject.points?.map((p: any) => p.step) ?? []),
    ...(graphicsObject.circles?.map((c: any) => c.step) ?? []),
    ...(graphicsObject.rects?.map((r: any) => r.step) ?? []),
  ].filter((step) => step !== undefined)

  const maxStep = Math.max(...allSteps, -1)

  // Filter to only include elements from the last step
  const lastStepGraphics: GraphicsObject = {
    lines: graphicsObject.lines?.filter((l: any) => l.step === maxStep) ?? [],
    points: graphicsObject.points?.filter((p: any) => p.step === maxStep) ?? [],
    circles:
      graphicsObject.circles?.filter((c: any) => c.step === maxStep) ?? [],
    rects: graphicsObject.rects?.filter((r: any) => r.step === maxStep) ?? [],
  }

  return getSvgFromGraphicsObject(lastStepGraphics, {
    backgroundColor: "white",
  })
}
