import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("terminal pad detection rejects distant obstacles before checking connectivity", () => {
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.45,
    vias: [],
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
  }
  const connMap = new ConnectivityMap({})
  let connectivityChecks = 0
  const areIdsConnected = connMap.areIdsConnected.bind(connMap)
  connMap.areIdsConnected = (left: string, right: string): boolean => {
    connectivityChecks += 1
    return areIdsConnected(left, right)
  }
  const solver = new TraceWidthSolver({
    hdRoutes: [route],
    minTraceWidth: 0.1,
    obstacleMargin: 0.1,
    layerCount: 2,
    connection: [
      { name: "signal", nominalTraceWidth: 0.15, pointsToConnect: [] },
    ],
    connMap,
    obstacles: [
      {
        type: "rect",
        center: { x: 10, y: 10 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["distant-pad"],
      },
    ],
  })

  solver.solve()

  expect(solver.getHdRoutesWithWidths()[0]!.traceThickness).toBe(0.15)
  expect(connectivityChecks).toBe(0)
})
