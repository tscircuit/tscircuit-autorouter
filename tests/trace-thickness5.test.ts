import { test, expect } from "bun:test"
import { validateTraceThicknessParameters } from "../lib/utils/getTraceThicknessFromConnection"

test("validateTraceThicknessParameters - valid", () => {
  const connection = {
    name: "test",
    pointsToConnect: [],
    traceThickness: 0.3,
  }

  expect(validateTraceThicknessParameters(connection)).toEqual([])
})
