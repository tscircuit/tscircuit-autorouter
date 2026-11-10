import { expect, test } from "bun:test"
import { assertDifferentialPairRoutes } from "lib/utils/assertDifferentialPairRoutes"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getDifferentialPairEsdRepro } from "../fixtures/getDifferentialPairEsdRepro"

test("an ordinary two-terminal branch cannot bypass an owned station", async (): Promise<void> => {
  const srj = await getDifferentialPairEsdRepro(7)
  // Synthetic boundary copper derived from TSX endpoints: the extra branch
  // touches J1 and MCU while going around, rather than through, ESD.
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
  const j1 = srj.connections[0]!.pointsToConnect[0]!
  const mcu = srj.connections[1]!.pointsToConnect[1]!
  srj.connections.push({ name: "bypass", pointsToConnect: [j1, mcu] })
  routes.push({
    connectionName: "bypass",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { ...j1, z: 0 },
      { x: j1.x, y: 3, z: 0 },
      { x: mcu.x, y: 3, z: 0 },
      { ...mcu, z: 0 },
    ],
  })
  expect(() =>
    assertDifferentialPairRoutes(
      { ...srj, differentialPairs: srj.differentialPairs! },
      routes,
      true,
    ),
  ).toThrow("bypasses owned terminals")
})
