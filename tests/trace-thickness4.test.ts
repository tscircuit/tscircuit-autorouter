import { test, expect } from "bun:test"
import {
  getViaDiameterFromConnection,
  STANDARD_VIA_DIAMETER,
} from "../lib/utils/getTraceThicknessFromConnection"

test("getViaDiameterFromConnection", () => {
  const connection1 = {
    name: "test",
    pointsToConnect: [],
    viaDiameter: 0.8,
  }

  const connection2 = {
    name: "test",
    pointsToConnect: [],
  }

  expect(getViaDiameterFromConnection(connection1)).toBe(0.8)
  expect(getViaDiameterFromConnection(connection2)).toBe(STANDARD_VIA_DIAMETER)
})
