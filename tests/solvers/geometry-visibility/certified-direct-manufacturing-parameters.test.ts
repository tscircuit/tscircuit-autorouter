import { expect, test } from "bun:test"
import { getCertifiedDirectRoutingPlan } from "lib/testing/getCertifiedDirectRoutingPlan"
import { getCertifiedDirectTestInput } from "tests/fixtures/certified-direct-input"

test("nonfinite rules and invalid terminal layers fail visibly instead of bypassing certification", () => {
  for (const key of ["minTraceToHoleEdgeClearance", "minBoardEdgeClearance", "defaultObstacleMargin"] as const) {
    const input = getCertifiedDirectTestInput()
    input[key] = Number.NaN
    expect(() => getCertifiedDirectRoutingPlan(input)).toThrow("finite manufactured geometry")
  }
  const input = getCertifiedDirectTestInput()
  input.connections[0].pointsToConnect[0] = { x: -1, y: 0, layers: ["top", "outside"] }
  expect(() => getCertifiedDirectRoutingPlan(input)).toThrow("outside original board")
})
