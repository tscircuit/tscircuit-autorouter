import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ObstacleConnectionIndex } from "lib/data-structures/ObstacleConnectionIndex"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import type { Obstacle } from "lib/types"

const createObstacle = (
  obstacleId: string,
  connectedTo: string[],
): Obstacle => ({
  obstacleId,
  type: "rect",
  layers: ["top", "bottom"],
  center: { x: 0, y: 0 },
  width: 1,
  height: 1,
  connectedTo,
})

test("returns the same connected obstacles in the original order", () => {
  const obstacles = [
    createObstacle("direct", ["route-a"]),
    createObstacle("same-net", ["pad-a"]),
    createObstacle("root-direct", ["root-b"]),
    createObstacle("root-net", ["pad-b"]),
    createObstacle("foreign", ["pad-c"]),
    createObstacle("duplicate-net-ids", ["route-a", "pad-a"]),
  ]
  obstacles.push(obstacles[0]!)
  const connMap = new ConnectivityMap({
    "net-a": ["route-a", "pad-a"],
    "net-b": ["root-b", "pad-b"],
    "net-c": ["pad-c"],
  })
  const index = new ObstacleConnectionIndex(obstacles, connMap)

  for (const route of [
    { connectionName: "route-a" },
    { connectionName: "synthetic", rootConnectionName: "root-b" },
    { connectionName: "unknown" },
    { connectionName: "net-a" },
  ]) {
    expect(index.getObstaclesConnectedToRoute(route)).toEqual(
      obstacles.filter((obstacle) =>
        isObstacleConnectedToRoute(obstacle, route, connMap),
      ),
    )
  }
})
