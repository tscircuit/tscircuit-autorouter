import { test, expect } from "bun:test"
import { validateTraceThicknessParameters } from "../lib/utils/getTraceThicknessFromConnection"

test("validateTraceThicknessParameters - invalid thickness", () => {
  const connection = {
    name: "test",
    pointsToConnect: [],
    traceThickness: -0.1,
  }

  const errors = validateTraceThicknessParameters(connection)
  expect(errors.length).toBe(1)
  expect(errors[0]).toContain("Must be positive")
})
