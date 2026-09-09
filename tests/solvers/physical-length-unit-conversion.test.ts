import { expect, test } from "bun:test"
import { getSolveSpaceLengthFromPhysicalLength } from "lib/utils/getSolveSpaceLengthFromPhysicalLength"

test("physical copper lengths convert once for expanded and contracted solve coordinates", (): void => {
  const physicalLength = 0.15 + 0.1
  for (const [solveToPhysicalScale, expected] of [
    [0.25, 1],
    [1, physicalLength],
    [2, 0.125],
  ]) {
    expect(
      getSolveSpaceLengthFromPhysicalLength({
        physicalLength,
        solveToPhysicalScale,
      }),
    ).toBe(expected)
    expect(
      getSolveSpaceLengthFromPhysicalLength({
        physicalLength: 0,
        solveToPhysicalScale,
      }),
    ).toBe(0)
  }
})
