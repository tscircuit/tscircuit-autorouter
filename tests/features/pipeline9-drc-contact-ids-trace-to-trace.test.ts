import { expect, test } from "bun:test"
import {
  getBoardContactIds,
  getBoardDrcErrors,
  trace,
  wire,
} from "tests/fixtures/pipeline9CopperContactBoard"

test("pipeline9 DRC names both traces in contact_ids when two nets' traces touch", () => {
  const traceA = trace("tA", "netA", [wire(-3, 0), wire(3, 0)])
  const crossingB = trace("tB", "netB", [
    wire(-3, 1),
    wire(-1, 1),
    wire(-1, 0.05),
    wire(1, 0.05),
    wire(1, 1),
    wire(3, 1),
  ])
  // 0.05mm apart: a clearance error, but no copper touches.
  const nearMissB = trace("tB", "netB", [
    wire(-3, 1),
    wire(-1, 1),
    wire(-1, 0.2),
    wire(1, 0.2),
    wire(1, 1),
    wire(3, 1),
  ])

  expect(getBoardContactIds([traceA, crossingB])).toEqual([["tA", "tB"]])
  expect(getBoardDrcErrors([traceA, nearMissB]).length).toBeGreaterThan(0)
  expect(getBoardContactIds([traceA, nearMissB])).toEqual([])
})
