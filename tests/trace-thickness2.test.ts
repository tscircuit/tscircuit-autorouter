import { test, expect } from "bun:test"
import {
  getTraceThicknessFromConnection,
  STANDARD_TRACE_THICKNESS,
} from "../lib/utils/getTraceThicknessFromConnection"

test("getTraceThicknessFromConnection - multiplier", () => {
  const connection = {
    name: "test",
    pointsToConnect: [],
    traceThicknessMultiplier: 2,
  }

  expect(getTraceThicknessFromConnection(connection)).toBe(0.3) // 2 * 0.15
})
