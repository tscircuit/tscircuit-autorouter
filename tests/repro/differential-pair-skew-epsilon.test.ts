import { expect, test } from "bun:test"
import { assertDifferentialPairRoutes } from "lib/utils/assertDifferentialPairRoutes"
import { getRoutingFailure } from "lib"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getDifferentialPairEsdRepro } from "../fixtures/getDifferentialPairEsdRepro"

test("final planar skew allows only the documented 1e-9mm numerical epsilon", async (): Promise<void> => {
  const srj = await getDifferentialPairEsdRepro(7)
  srj.differentialPairs![0]!.maxLengthSkewMm = 0
  const routes: HighDensityRoute[] = srj.connections.map(
    (connection): HighDensityRoute => ({
      connectionName: connection.name,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: connection.pointsToConnect.map(
        (point): HighDensityRoute["route"][number] => ({
          x: point.x,
          y: point.y,
          z: 0,
        }),
      ),
    }),
  )
  const start = routes[0]!.route[0]!
  routes[0]!.route.splice(1, 0, { x: 0, y: start.y + 0.00005, z: 0 })
  const input = { ...srj, differentialPairs: srj.differentialPairs! }
  expect(() => assertDifferentialPairRoutes(input, routes, true)).not.toThrow()
  routes[0]!.route[1]!.y = start.y + 0.0002
  try {
    assertDifferentialPairRoutes(input, routes, true)
    throw new Error("Expected final skew to fail")
  } catch (error) {
    const failure = getRoutingFailure(error)
    expect(failure).toMatchObject({ reason: "length_skew", pairIndex: 0 })
    if (failure.reason !== "length_skew") throw error
    expect(failure.laneLengthsMm[0]).toBeGreaterThan(
      failure.laneLengthsMm[1] + 1e-9,
    )
  }
})
