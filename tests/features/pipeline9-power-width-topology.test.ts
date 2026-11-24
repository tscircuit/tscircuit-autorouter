import { expect, test } from "bun:test"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import type { ConnectionPoint, SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("Pipeline 9 uses source path widths before off-board endpoint substitution", (): void => {
  const pad = (pointId: string, x: number, y: number): ConnectionPoint => ({
    pointId, x, y, layer: "top",
  })
  const junction = pad("junction", 0, 0)
  const monitor = pad("monitor", 0, 1)
  const driver = pad("driver", 5, 0)
  const remoteJunction = pad("remote-junction", 4.5, 0)
  const input: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 6, minY: -1, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [
      {
        name: "sense",
        nominalTraceWidth: 0.15,
        pointsToConnect: [junction, monitor],
        externallyConnectedPointIds: [["junction", "monitor"]],
      },
      {
        name: "supply",
        nominalTraceWidth: 0.15,
        pointsToConnect: [junction, driver],
      },
      {
        name: "cable",
        isOffBoard: true,
        pointsToConnect: [junction, remoteJunction],
      },
    ],
    buses: [{ busId: "power", connectionNames: ["supply"], traceWidth: 0.8 }],
  }
  const solver = new NetToPointPairsSolver2_OffBoardConnection(
    input,
    {},
    getInitiallyConnectedMapFromSimpleRouteJson(input),
    { preserveBranchWidths: true },
  )
  solver.solve()

  expect(solver.newConnections).toHaveLength(1)
  const [pair] = solver.newConnections
  expect(pair!.pointsToConnect.map((point) => point.pointId).sort()).toEqual([
    "driver",
    "remote-junction",
  ])
  expect(pair!.nominalTraceWidth).toBe(0.8)
})
