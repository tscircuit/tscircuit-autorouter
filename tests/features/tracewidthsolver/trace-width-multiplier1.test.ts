import { test, expect } from "bun:test"
import { getEffectiveNominalTraceWidth } from "lib/utils/getEffectiveNominalTraceWidth"
import { SimpleRouteConnection } from "lib/types"

test("getEffectiveNominalTraceWidth - returns nominalTraceWidth when set", () => {
  const connection: SimpleRouteConnection = {
    name: "VCC",
    nominalTraceWidth: 0.6,
    traceWidthMultiplier: 2,
    pointsToConnect: [],
  }
  expect(getEffectiveNominalTraceWidth(connection, 0.15)).toBe(0.6)
})
