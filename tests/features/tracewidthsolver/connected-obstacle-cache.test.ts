import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("reuses obstacle connectivity while scanning a trace", (): void => {
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
  const connMap = new ConnectivityMap({ signalNet: ["signal", "signalPad"] })
  const areIdsConnected = spyOn(connMap, "areIdsConnected")

  try {
    const solver = new TraceWidthSolver({
      hdRoutes: [route],
      minTraceWidth: 0.1,
      obstacleMargin: 0.1,
      layerCount: 2,
      connMap,
      connection: [
        { name: "signal", nominalTraceWidth: 0.2, pointsToConnect: [] },
      ],
      obstacles: [
        {
          type: "rect",
          center: { x: 0, y: 0 },
          width: 0.5,
          height: 0.5,
          layers: ["top"],
          connectedTo: ["signalPad"],
        },
      ],
    })

    solver.solve()

    expect(solver.getHdRoutesWithWidths()[0]?.traceThickness).toBe(0.2)
    // The two endpoint pad checks are separate from the cursor scan.
    expect(areIdsConnected).toHaveBeenCalledTimes(3)
  } finally {
    areIdsConnected.mockRestore()
  }
})
