import { expect, test } from "bun:test"
import { getSolveSpaceLengthFromPhysicalLength } from "lib/utils/getSolveSpaceLengthFromPhysicalLength"

test("physical copper length conversion rejects invalid units and nonfinite results", (): void => {
  for (const physicalLength of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect((): void => {
      getSolveSpaceLengthFromPhysicalLength({
        physicalLength,
        solveToPhysicalScale: 1,
      })
    }).toThrow("Physical clearance length must be finite and nonnegative")
  }
  for (const solveToPhysicalScale of [
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    expect((): void => {
      getSolveSpaceLengthFromPhysicalLength({
        physicalLength: 0.25,
        solveToPhysicalScale,
      })
    }).toThrow("Solve-to-physical scale must be finite and positive")
  }
  expect((): void => {
    getSolveSpaceLengthFromPhysicalLength({
      physicalLength: Number.MAX_VALUE,
      solveToPhysicalScale: Number.MIN_VALUE,
    })
  }).toThrow("Converted solve-space clearance length must be finite")
  expect((): void => {
    getSolveSpaceLengthFromPhysicalLength({
      physicalLength: Number.MIN_VALUE,
      solveToPhysicalScale: Number.MAX_VALUE,
    })
  }).toThrow("Positive physical clearance length underflows solve space")
})
