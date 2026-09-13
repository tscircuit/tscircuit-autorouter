import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import type { Obstacle } from "lib/types"

test("obstacle connectivity accepts a canonical net id", () => {
  const connMap = new ConnectivityMap({
    "shared-net": ["route-alias", "pad-alias"],
  })
  const canonicalNet = connMap.getNetConnectedToId("route-alias")!
  const obstacle: Obstacle = {
    type: "rect",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    layers: ["top"],
    connectedTo: [canonicalNet],
  }

  expect(
    isObstacleConnectedToRoute(
      obstacle,
      { connectionName: "route-alias" },
      connMap,
    ),
  ).toBeTrue()
  expect(
    isObstacleConnectedToRoute(
      obstacle,
      { connectionName: "different-net" },
      connMap,
    ),
  ).toBeFalse()
})
