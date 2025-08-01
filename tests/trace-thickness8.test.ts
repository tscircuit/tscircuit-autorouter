import { test, expect } from "bun:test"
import { COMMON_TRACE_MULTIPLIERS } from "../lib/utils/getTraceThicknessFromConnection"

test("standard multipliers are correct", () => {
  expect(COMMON_TRACE_MULTIPLIERS[1]).toBe(0.15)
  expect(COMMON_TRACE_MULTIPLIERS[2]).toBe(0.3)
  expect(COMMON_TRACE_MULTIPLIERS[4]).toBe(0.6)
  expect(COMMON_TRACE_MULTIPLIERS[8]).toBe(1.2)
})
