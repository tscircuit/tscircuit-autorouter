import { test, expect } from "bun:test"
import {
  getTraceThicknessFromConnection,
  getViaDiameterFromConnection,
  validateTraceThicknessParameters,
  STANDARD_TRACE_THICKNESS,
  STANDARD_VIA_DIAMETER,
} from "../lib/utils/getTraceThicknessFromConnection"

test("getTraceThicknessFromConnection - explicit thickness", () => {
  const connection = {
    name: "test",
    pointsToConnect: [],
    traceThickness: 0.3,
  }

  expect(getTraceThicknessFromConnection(connection)).toBe(0.3)
})
