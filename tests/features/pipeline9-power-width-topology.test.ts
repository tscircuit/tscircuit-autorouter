import { expect, test } from "bun:test"
import { collectPipeline9PowerTraceWidthTargets } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/collectPipeline9PowerTraceWidthTargets"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import type { ConnectionPoint, SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("Pipeline 9 uses source path widths before off-board endpoint substitution", (): void => {
  const junction: ConnectionPoint = {
    x: 0,
    y: 0,
    layer: "top",
    pointId: "junction",
  }
  const monitor: ConnectionPoint = {
    x: 0,
    y: 1,
    layer: "top",
    pointId: "monitor",
  }
  const driver: ConnectionPoint = {
    x: 5,
    y: 0,
    layer: "top",
    pointId: "driver",
  }
  const remoteJunction: ConnectionPoint = {
    x: 4.5,
    y: 0,
    layer: "top",
    pointId: "remote-junction",
  }
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
  const targets = new Map<string, number>()
  const solver = new NetToPointPairsSolver2_OffBoardConnection(
    input,
    {},
    getInitiallyConnectedMapFromSimpleRouteJson(input),
    (topology) => {
      collectPipeline9PowerTraceWidthTargets(
        topology,
        input.minTraceWidth,
        targets,
      )
    },
  )
  solver.solve()

  expect(solver.newConnections).toHaveLength(1)
  const [pair] = solver.newConnections
  expect(pair!.pointsToConnect.map((point) => point.pointId).sort()).toEqual([
    "driver",
    "remote-junction",
  ])
  expect(targets).toEqual(new Map([[pair!.name, 0.8]]))
})
