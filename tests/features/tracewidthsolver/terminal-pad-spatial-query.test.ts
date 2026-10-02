import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("terminal taper only checks obstacles at the route endpoint", (): void => {
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ],
  }
  const terminalPad: Obstacle = {
    type: "rect",
    center: { x: 0, y: 0 },
    width: 1,
    height: 0.4,
    layers: ["top"],
    connectedTo: ["pad"],
  }
  const unrelatedObstacles: Obstacle[] = Array.from(
    { length: 100 },
    (_, index) => ({
      type: "rect",
      center: { x: 100 + index, y: 100 },
      width: 0.5,
      height: 0.5,
      layers: ["top"],
      connectedTo: [`unrelated_${index}`],
    }),
  )
  const connMap = new ConnectivityMap({ signal_net: ["signal", "pad"] })
  const areIdsConnected = spyOn(connMap, "areIdsConnected")

  try {
    const solver = new TraceWidthSolver({
      hdRoutes: [route],
      connection: [
        { name: "signal", nominalTraceWidth: 0.8, pointsToConnect: [] },
      ],
      obstacles: [terminalPad, ...unrelatedObstacles],
      connMap,
      minTraceWidth: 0.1,
      layerCount: 2,
    })

    solver.solve()

    expect(solver.getHdRoutesWithWidths()[0]?.route[0]?.traceThickness).toBe(
      0.4,
    )
    expect(areIdsConnected.mock.calls.length).toBeLessThan(10)
  } finally {
    areIdsConnected.mockRestore()
  }
})
