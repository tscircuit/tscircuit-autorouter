import { expect, test } from "bun:test"
import { assertDifferentialPairRoutes } from "lib/utils/assertDifferentialPairRoutes"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getDifferentialPairEsdRepro } from "../fixtures/getDifferentialPairEsdRepro"

test("owned via copper cannot make an undeclared contact to an ordinary tap", async (): Promise<void> => {
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
  const hop = routes[0]!
  const start = hop.route[0]!
  hop.route.splice(
    1,
    0,
    { x: 0, y: start.y, z: 0 },
    { x: 0, y: start.y, z: 1 },
    { x: 1, y: start.y, z: 1 },
    { x: 1, y: start.y, z: 0 },
  )
  hop.vias = [
    { x: 0, y: start.y },
    { x: 1, y: start.y },
  ]
  const tap = routes[4]!
  tap.route.splice(
    1,
    0,
    { x: 5, y: -1, z: 0 },
    { x: 0, y: start.y + 0.15, z: 0 },
  )
  expect(() =>
    assertDifferentialPairRoutes(
      { ...srj, differentialPairs: srj.differentialPairs! },
      routes,
      true,
    ),
  ).toThrow("ownership violation")
})
