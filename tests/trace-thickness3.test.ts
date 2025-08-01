import { test, expect } from "bun:test"
import {
  getTraceThicknessFromConnection,
  STANDARD_TRACE_THICKNESS,
} from "../lib/utils/getTraceThicknessFromConnection"

test("getTraceThicknessFromConnection - default", () => {
  const connection = {
    name: "test",
    pointsToConnect: [],
  }

  expect(getTraceThicknessFromConnection(connection)).toBe(
    STANDARD_TRACE_THICKNESS,
  )
})
