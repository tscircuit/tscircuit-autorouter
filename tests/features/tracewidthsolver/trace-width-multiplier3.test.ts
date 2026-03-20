import { test, expect } from "bun:test"
import { getEffectiveNominalTraceWidth } from "lib/utils/getEffectiveNominalTraceWidth"
import { SimpleRouteConnection } from "lib/types"

test("getEffectiveNominalTraceWidth - returns undefined when neither is set", () => {
  const connection: SimpleRouteConnection = {
    name: "data",
    pointsToConnect: [],
  }
  expect(getEffectiveNominalTraceWidth(connection, 0.15)).toBeUndefined()
})
