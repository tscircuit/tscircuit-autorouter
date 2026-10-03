import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("high-density repair resolves connectivity only for obstacles containing a route", () => {
  const route: HighDensityRoute = {
    connectionName: "signal",
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    traceThickness: 0.1,
    viaDiameter: 0.5,
    vias: [],
  }
  const distantObstacles: Obstacle[] = Array.from(
    { length: 100 },
    (_, index) => ({
      type: "rect",
      center: { x: 100 + index, y: 100 },
      width: 1,
      height: 1,
      layers: ["top", "bottom"],
      connectedTo: [`pad-${index}`],
    }),
  )
  const connMap = new ConnectivityMap({ signal: ["signal"] })
  const connectivityCheck = spyOn(connMap, "areIdsConnected")

  try {
    new Pipeline4HighDensityRepairSolver({
      nodeWithPortPoints: [],
      hdRoutes: [route],
      obstacles: distantObstacles,
      connMap,
    })

    expect(connectivityCheck).not.toHaveBeenCalled()
  } finally {
    connectivityCheck.mockRestore()
  }
})
