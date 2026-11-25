import { expect, test } from "bun:test"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import type { SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("a capacitor tap does not replace or inherit the bounded crystal connection", () => {
  const mcu = { pointId: "MCU", x: 0, y: 0, layer: "top" }
  const crystal = { pointId: "XTAL", x: 4, y: 0, layer: "top" }
  const capacitor = { pointId: "CAP", x: 2, y: 0, layer: "top" }
  const input: SimpleRouteJson = {
    layerCount: 2,
    bounds: { minX: -1, maxX: 5, minY: -1, maxY: 1 },
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [
      {
        name: "oscillator",
        pointsToConnect: [mcu, crystal],
        maxLength: 10,
        maxViaCount: 0,
      },
      { name: "capacitor", pointsToConnect: [crystal, capacitor] },
    ],
  }
  const solver = new NetToPointPairsSolver2_OffBoardConnection(
    input,
    {},
    getInitiallyConnectedMapFromSimpleRouteJson(input),
  )
  solver.solve()
  expect(solver.newConnections).toHaveLength(2)
  const trunk = solver.newConnections.find(
    (connection) => connection.maxLength === 10,
  )!
  expect(trunk.pointsToConnect.map((point) => point.pointId).sort()).toEqual([
    "MCU",
    "XTAL",
  ])
  expect(trunk.maxViaCount).toBe(0)
  const tap = solver.newConnections.find((connection) => connection !== trunk)!
  expect(tap.pointsToConnect).toContainEqual(capacitor)
  expect(tap.maxLength).toBeUndefined()
  expect(tap.maxViaCount).toBeUndefined()
})
