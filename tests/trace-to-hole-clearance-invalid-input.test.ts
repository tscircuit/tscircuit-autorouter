import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { createSrjWithHoleClearance } from "lib/utils/createSrjWithHoleClearance"
import fixture from "./fixtures/hole-clearance/npth.srj.json"

test("invalid NPTH rules and hole geometry fail at the input boundary", (): void => {
  const srj = structuredClone(fixture) as SimpleRouteJson
  for (const value of [-0.2, NaN, Infinity]) {
    srj.minTraceToHoleEdgeClearance = value
    expect(() => createSrjWithHoleClearance(srj)).toThrow("finite non-negative")
  }
  srj.minTraceToHoleEdgeClearance = 0.2
  const hole = srj.obstacles[2]!
  hole.isHole = true
  hole.connectedTo = ["signal"]
  expect(() => createSrjWithHoleClearance(srj)).toThrow("empty connectedTo")
  hole.connectedTo = []
  hole.width = -2
  expect(() => createSrjWithHoleClearance(srj)).toThrow("invalid geometry")
  hole.width = 1
  hole.shape = "circle"
  expect(() => createSrjWithHoleClearance(srj)).toThrow("invalid geometry")
})
