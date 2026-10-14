import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"
import { loadScenarioBySampleNumber } from "scripts/benchmark/scenarios"

const affectedPowerNetIds = new Set([
  "source_net_altium_pcb_378", // SGND
  "source_net_altium_pcb_385", // PGND
])

test("PMP22650 point-pair trees span every SGND and PGND terminal", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj24", 24)
  const inputSrj = {
    ...scenario,
    connections: scenario.connections.filter((connection) =>
      affectedPowerNetIds.has(connection.name),
    ),
  }
  const solver = new NetToPointPairsSolver2_OffBoardConnection(
    inputSrj,
    {},
    getInitiallyConnectedMapFromSimpleRouteJson(inputSrj),
  )
  solver.solve()
  for (const connection of solver.newConnections) {
    solver.colorMap[connection.name] = connection.__rootConnectionNames?.includes(
      "source_net_altium_pcb_378",
    )
      ? "#2563eb"
      : "#dc2626"
  }

  await expect(
    getSvgFromGraphicsObject(solver.visualize(), {
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)

  const requiredPairCount = inputSrj.connections.reduce(
    (sum, connection) => sum + connection.pointsToConnect.length - 1,
    0,
  )
  expect(solver.newConnections).toHaveLength(requiredPairCount)
})
