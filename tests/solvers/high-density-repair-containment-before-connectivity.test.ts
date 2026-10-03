import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("high-density repair rejects distant obstacles before connectivity checks", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    portPoints: [
      { x: -1, y: 0, z: 0, connectionName: "route" },
      { x: 1, y: 0, z: 0, connectionName: "route" },
    ],
  }
  const route: HighDensityRoute = {
    connectionName: "route",
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    traceThickness: 0.15,
    viaDiameter: 0.3,
    vias: [],
  }
  const distantObstacles: Obstacle[] = Array.from(
    { length: 1_000 },
    (_, index) => ({
      type: "rect",
      center: { x: 100 + index, y: 100 },
      width: 1,
      height: 1,
      layers: ["top", "bottom"],
      connectedTo: ["pad"],
    }),
  )
  const connMap = new ConnectivityMap({ net: ["route", "pad"] })
  const areIdsConnected = connMap.areIdsConnected.bind(connMap)
  let connectivityCheckCount = 0
  connMap.areIdsConnected = (firstId, secondId) => {
    connectivityCheckCount += 1
    return areIdsConnected(firstId, secondId)
  }

  new Pipeline4HighDensityRepairSolver({
    nodeWithPortPoints: [node],
    hdRoutes: [route],
    obstacles: distantObstacles,
    connMap,
  })

  expect(connectivityCheckCount).toBe(0)
})
