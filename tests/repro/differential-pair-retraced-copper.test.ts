import { expect, test } from "bun:test"
import { assertDifferentialPairRoutes } from "lib/utils/assertDifferentialPairRoutes"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getDifferentialPairEsdRepro } from "../fixtures/getDifferentialPairEsdRepro"

test("a hop cannot inflate its measured length by retracing a copper stub", async (): Promise<void> => {
  const srj = await getDifferentialPairEsdRepro(7)
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
  routes[0]!.route.splice(1, 0, { x: 6, y: routes[0]!.route[0]!.y, z: 0 })
  expect(() =>
    assertDifferentialPairRoutes(
      { ...srj, differentialPairs: srj.differentialPairs! },
      routes,
      false,
    ),
  ).toThrow("retraces its own copper")
})
