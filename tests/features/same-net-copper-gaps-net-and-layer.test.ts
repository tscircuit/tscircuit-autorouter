import { expect, test } from "bun:test"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import { createDrcConnectivityMap } from "lib/utils/createDrcConnectivityMap"
import { getSameNetCopperGapBridges } from "lib/utils/getSameNetCopperGapBridges"
import { createSameNetCopperGapTestCase } from "tests/fixtures/createSameNetCopperGapTestCase"

test("gap bridges require the same electrical net and physical layer, and repair tangencies", (): void => {
  for (const variant of [
    "same",
    "foreign",
    "other-layer",
    "tangent",
    "wide",
  ] as const) {
    const { srj, traces } = createSameNetCopperGapTestCase()
    if (variant === "foreign") {
      traces[1].connection_name = "signal"
      srj.connections.push({ name: "signal", pointsToConnect: [] })
    }
    if (variant === "other-layer")
      for (const point of traces[1].route) {
        if (point.route_type === "wire") point.layer = "bottom"
      }
    const point = traces[1].route[0]
    if (point.route_type === "wire" && variant === "tangent") point.x = 0.1
    if (point.route_type === "wire" && variant === "wide") point.x = 0.25
    const circuitJson = convertToCircuitJson(srj, traces)
    let validations = 0
    const bridges = getSameNetCopperGapBridges({
      circuitJson,
      traces,
      connMap: createDrcConnectivityMap(circuitJson),
      minimumClearance: 0.1,
      traceWidth: 0.1,
      validate: () => {
        validations++
      },
    })
    const expected = variant === "same" || variant === "tangent" ? 1 : 0
    expect(bridges.length, variant).toBe(expected)
    expect(validations, variant).toBe(expected)
  }
})
