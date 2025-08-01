import { test, expect } from "bun:test"
import { validateTraceThicknessParameters } from "../lib/utils/getTraceThicknessFromConnection"

test("validateTraceThicknessParameters - conflicting parameters", () => {
  const connection = {
    name: "test",
    pointsToConnect: [],
    traceThickness: 0.3,
    traceThicknessMultiplier: 2,
  }

  const errors = validateTraceThicknessParameters(connection)
  expect(errors.length).toBe(1)
  expect(errors[0]).toContain(
    "both traceThickness and traceThicknessMultiplier",
  )
})
