import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  getObstacleRouteConnectivity,
  type ObstacleRouteConnectivity,
} from "lib/solvers/HyperHighDensitySolver/getObstacleRouteConnectivity"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

type RouteConnection = Pick<
  HighDensityRoute,
  "connectionName" | "rootConnectionName"
>

test("obstacle ownership preserves both original views without rescanning repeated IDs", (): void => {
  const connMap = new ConnectivityMap({
    netA: ["current", "root_only", "netB"],
    netB: ["aliased_pad"],
    netC: ["other_root", "other_pad"],
  })
  const routes: RouteConnection[] = [
    { connectionName: "current", rootConnectionName: "direct_root" },
    { connectionName: "duplicate", rootConnectionName: "root_only" },
    { connectionName: "duplicate", rootConnectionName: "other_root" },
    { connectionName: "netB" },
    { connectionName: "unmapped" },
  ]
  const obstacles: Obstacle[] = [
    ["current", "current"],
    ["duplicate", "duplicate"],
    ["direct_root", "direct_root"],
    ["root_only", "root_only"],
    ["aliased_pad", "aliased_pad"],
    ["other_pad", "other_pad"],
    Array.from({ length: 512 }, (): string => "unknown"),
    [],
  ].map((connectedTo, index): Obstacle => ({
    obstacleId: "repeated-obstacle-id",
    type: "rect",
    center: { x: index, y: 0 },
    width: 0.5,
    height: 0.5,
    layers: ["top"],
    connectedTo,
    circuitJsonMetadata: { pcb_port_id: `pcb_port_${index}` },
  }))
  const originalInput = JSON.stringify({ obstacles, routes })
  for (const obstacle of obstacles) {
    Object.freeze(obstacle.connectedTo)
    Object.freeze(obstacle.center)
    Object.freeze(obstacle.layers)
    Object.freeze(obstacle.circuitJsonMetadata)
    Object.freeze(obstacle)
  }
  for (const route of routes) Object.freeze(route)
  Object.freeze(obstacles)
  Object.freeze(routes)

  // The package accepts this asymmetric alias even though the two IDs map to
  // different nets. Keep its predicate rather than substituting net equality.
  expect(connMap.areIdsConnected("netB", "aliased_pad")).toBeTrue()
  const connectivityCalls = spyOn(connMap, "areIdsConnected")
  try {
    for (const map of [connMap, undefined]) {
      connectivityCalls.mockClear()
      const expected: ObstacleRouteConnectivity = {
        connectedRouteNamesByObstacle: obstacles.map((obstacle): string[] =>
          routes
            .filter((route): boolean =>
              isObstacleConnectedToRoute(obstacle, route, map),
            )
            .map((route): string => route.connectionName),
        ),
        connectedObstaclesByRoute: routes.map((route): Obstacle[] =>
          obstacles.filter((obstacle): boolean =>
            isObstacleConnectedToRoute(obstacle, route, map),
          ),
        ),
      }
      const originalCallCount = connectivityCalls.mock.calls.length
      connectivityCalls.mockClear()
      const actual = getObstacleRouteConnectivity({
        obstacles,
        routes,
        connMap: map,
      })

      expect(actual).toEqual(expected)
      expect(actual.connectedRouteNamesByObstacle[1]).toEqual([
        "duplicate",
        "duplicate",
      ])
      expect(actual.connectedObstaclesByRoute[1]).not.toEqual(
        actual.connectedObstaclesByRoute[2],
      )
      expect(actual.connectedObstaclesByRoute[0]![0]).toBe(obstacles[0])
      if (map) {
        expect(connectivityCalls.mock.calls.length).toBeLessThan(
          originalCallCount / 10,
        )
      }
      expect(JSON.stringify({ obstacles, routes })).toBe(originalInput)
    }
  } finally {
    connectivityCalls.mockRestore()
  }
})
