import type { Bounds } from "@tscircuit/math-utils"
import { expect } from "bun:test"
import type { PolyLine2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"
import { isDeepStrictEqual } from "node:util"

export function expectBoundaryProjectionCorrection({
  actual,
  reference,
  before,
  bounds,
  padding,
}: {
  actual: PolyLine2[]
  reference: PolyLine2[]
  before: PolyLine2[]
  bounds: Bounds
  padding: number
}): number {
  let correctedPoints = 0
  for (let lineIndex = 0; lineIndex < actual.length; lineIndex++) {
    for (
      let pointIndex = 0;
      pointIndex < actual[lineIndex]!.mPoints.length;
      pointIndex++
    ) {
      const point = actual[lineIndex]!.mPoints[pointIndex]!
      const referencePoint = reference[lineIndex]!.mPoints[pointIndex]!
      if (isDeepStrictEqual(point, referencePoint)) continue
      // These frozen fixtures certify only pure boundary projections of regular
      // points. The independent segment-force oracle and sub-EPS regression
      // separately check clamp(point + force), including tangential movement.
      const beforePoint = before[lineIndex]!.mPoints[pointIndex]!
      expect(beforePoint.z1).toBe(beforePoint.z2)
      expect(isDeepStrictEqual(referencePoint, beforePoint)).toBe(true)
      expect(
        beforePoint.x < bounds.minX + padding ||
          beforePoint.x > bounds.maxX - padding ||
          beforePoint.y < bounds.minY + padding ||
          beforePoint.y > bounds.maxY - padding,
      ).toBe(true)
      const projected = {
        ...beforePoint,
        x: Math.max(
          bounds.minX + padding,
          Math.min(bounds.maxX - padding, beforePoint.x),
        ),
        y: Math.max(
          bounds.minY + padding,
          Math.min(bounds.maxY - padding, beforePoint.y),
        ),
      }
      expect(isDeepStrictEqual(point, projected)).toBe(true)
      referencePoint.x = projected.x
      referencePoint.y = projected.y
      correctedPoints++
    }
  }
  expect(isDeepStrictEqual(actual, reference)).toBe(true)
  return correctedPoints
}
