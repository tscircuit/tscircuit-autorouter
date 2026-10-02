import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("reuses route connectivity while scanning a trace", (): void => {
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -2, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
  }
  const sameNetRoute: HighDensityRoute = {
    connectionName: "same-net",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -2, y: 0.15, z: 0 },
      { x: 2, y: 0.15, z: 0 },
    ],
  }
  const connMap = new ConnectivityMap({ signalNet: ["signal", "same-net"] })
  const areIdsConnected = spyOn(connMap, "areIdsConnected")

  try {
    const solver = new TraceWidthSolver({
      hdRoutes: [route, sameNetRoute],
      minTraceWidth: 0.1,
      obstacleMargin: 0.1,
      layerCount: 2,
      connMap,
      connection: [
        { name: "signal", nominalTraceWidth: 0.2, pointsToConnect: [] },
      ],
      obstacles: [],
    })

    solver.solve()

    expect(solver.getHdRoutesWithWidths()[0]?.traceThickness).toBe(0.2)
    expect(areIdsConnected).toHaveBeenCalledTimes(1)
  } finally {
    areIdsConnected.mockRestore()
  }
})
