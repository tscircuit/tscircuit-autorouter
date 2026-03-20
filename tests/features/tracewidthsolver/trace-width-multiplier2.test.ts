import { test, expect } from "bun:test"
import { getEffectiveNominalTraceWidth } from "lib/utils/getEffectiveNominalTraceWidth"
import { SimpleRouteConnection } from "lib/types"

test("getEffectiveNominalTraceWidth - computes from multiplier when nominalTraceWidth is not set", () => {
  const minTraceWidth = 0.15
  const testCases = [
    { multiplier: 2, expected: 0.3 },
    { multiplier: 4, expected: 0.6 },
    { multiplier: 8, expected: 1.2 },
  ]
  for (const { multiplier, expected } of testCases) {
    const connection: SimpleRouteConnection = {
      name: `power_${multiplier}x`,
      traceWidthMultiplier: multiplier,
      pointsToConnect: [],
    }
    expect(
      getEffectiveNominalTraceWidth(connection, minTraceWidth),
    ).toBeCloseTo(expected)
  }
})
