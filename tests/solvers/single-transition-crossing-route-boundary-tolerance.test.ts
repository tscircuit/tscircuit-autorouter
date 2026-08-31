import { expect, test } from "bun:test"
import { pointToAngle } from "lib/solvers/HighDensitySolver/TwoRouteHighDensitySolver/calculateSideTraversal"
import {
  BOUNDARY_COORDINATE_TOLERANCE_MM,
  classifyPointInBounds,
} from "lib/utils/classifyPointInBounds"

test("single-transition stages classify every boundary with one tolerance", () => {
  const bounds = { minX: 0, maxX: 10, minY: 0, maxY: 10 }
  const acceptedOffsetMm = BOUNDARY_COORDINATE_TOLERANCE_MM * 0.5
  const rejectedOffsetMm = BOUNDARY_COORDINATE_TOLERANCE_MM * 1.1
  const acceptedPoints = [
    { x: 5, y: bounds.maxY + acceptedOffsetMm },
    { x: bounds.maxX + acceptedOffsetMm, y: 5 },
    { x: 5, y: bounds.minY - acceptedOffsetMm },
    { x: bounds.minX - acceptedOffsetMm, y: 5 },
    {
      x: bounds.minX - acceptedOffsetMm,
      y: bounds.maxY + acceptedOffsetMm,
    },
    {
      x: bounds.maxX + acceptedOffsetMm,
      y: bounds.maxY + acceptedOffsetMm,
    },
    {
      x: bounds.maxX + acceptedOffsetMm,
      y: bounds.minY - acceptedOffsetMm,
    },
    {
      x: bounds.minX - acceptedOffsetMm,
      y: bounds.minY - acceptedOffsetMm,
    },
  ]
  const rejectedPoints = [
    { x: 5, y: bounds.maxY + rejectedOffsetMm },
    { x: bounds.maxX + rejectedOffsetMm, y: 5 },
    { x: 5, y: bounds.minY - rejectedOffsetMm },
    { x: bounds.minX - rejectedOffsetMm, y: 5 },
    {
      x: bounds.minX - rejectedOffsetMm,
      y: bounds.maxY + rejectedOffsetMm,
    },
    {
      x: bounds.maxX + rejectedOffsetMm,
      y: bounds.maxY + rejectedOffsetMm,
    },
    {
      x: bounds.maxX + rejectedOffsetMm,
      y: bounds.minY - rejectedOffsetMm,
    },
    {
      x: bounds.minX - rejectedOffsetMm,
      y: bounds.minY - rejectedOffsetMm,
    },
  ]

  for (const point of acceptedPoints) {
    expect(classifyPointInBounds({ point, bounds })).toBe("on-boundary")
    expect(() => pointToAngle(point, bounds)).not.toThrow()
  }

  for (const point of rejectedPoints) {
    expect(classifyPointInBounds({ point, bounds })).toBe("outside")
    expect(() => pointToAngle(point, bounds)).toThrow(
      "does not lie on the boundary",
    )
  }
})
