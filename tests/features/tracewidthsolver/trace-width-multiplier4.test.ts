import { test, expect } from "bun:test"
import { getEffectiveNominalTraceWidth } from "lib/utils/getEffectiveNominalTraceWidth"
import { SimpleRouteConnection } from "lib/types"

test("getEffectiveNominalTraceWidth - returns undefined for multiplier of 1", () => {
  const connection: SimpleRouteConnection = {
    name: "data",
    traceWidthMultiplier: 1,
    pointsToConnect: [],
  }
  expect(getEffectiveNominalTraceWidth(connection, 0.15)).toBeUndefined()
})
