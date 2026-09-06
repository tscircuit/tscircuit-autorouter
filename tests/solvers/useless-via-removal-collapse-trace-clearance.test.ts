import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type CollapsePosition = "first" | "middle" | "last"

test("all basic section collapses preserve trace clearance and allow clear layers", (): void => {
  const positions: CollapsePosition[] = ["first", "middle", "last"]
  for (const position of positions) {
    for (const foreignThickness of [0.1, 0.4]) {
      for (const control of ["blocked", "clear", "other-layer", "same-net"]) {
        const route: HighDensityRoute = {
          connectionName: "moving_branch",
          rootConnectionName: "moving_net",
          traceThickness: 0.2,
          viaDiameter: 0.3,
          route:
            position === "middle"
              ? [
                  { x: 0, y: 0, z: 0 },
                  { x: 1, y: 0, z: 0 },
                  { x: 1, y: 0, z: 1 },
                  { x: 3, y: 0, z: 1 },
                  { x: 3, y: 0, z: 0 },
                  { x: 4, y: 0, z: 0 },
                ]
              : [
                  { x: 0, y: 0, z: 1 },
                  { x: 1, y: 0, z: 1 },
                  { x: 1, y: 0, z: 0 },
                  { x: 2, y: 0, z: 0 },
                ],
          vias:
            position === "middle"
              ? [{ x: 1, y: 0 }, { x: 3, y: 0 }]
              : [{ x: 1, y: 0 }],
        }
        if (position === "last") route.route.reverse()
        const requiredSeparation =
          route.traceThickness / 2 + foreignThickness / 2 + 0.1
        const separation =
          requiredSeparation + (control === "clear" ? 0.05 : -0.04)
        const foreignRoute: HighDensityRoute = {
          connectionName: "neighbor_branch",
          rootConnectionName: "neighbor_net",
          traceThickness: foreignThickness,
          viaDiameter: 0.6,
          route: [
            {
              x: position === "middle" ? 1.5 : 0.3,
              y: separation,
              z: control === "other-layer" ? 2 : 0,
            },
            {
              x: position === "middle" ? 2.5 : 0.7,
              y: separation,
              z: control === "other-layer" ? 2 : 0,
            },
          ],
          vias: [],
        }
        const endpointObstacle: Obstacle = {
          type: "rect",
          layers: ["top", "bottom"],
          __zLayers: [0, 1],
          center: { x: 0, y: 0 },
          width: 0.2,
          height: 0.2,
          connectedTo: [route.connectionName],
        }
        const connMap = new ConnectivityMap({
          route_net: [route.connectionName, route.rootConnectionName!],
          foreign_net: [
            foreignRoute.connectionName,
            foreignRoute.rootConnectionName!,
          ],
        })
        if (control === "same-net") {
          connMap.addConnections([
            [route.connectionName, foreignRoute.connectionName],
          ])
        }
        const solver = new SingleRouteUselessViaRemovalSolver({
          obstacleSHI: new ObstacleSpatialHashIndex(
            "flatbush",
            position === "middle" ? [] : [endpointObstacle],
          ),
          hdRouteSHI: new HighDensityRouteSpatialIndex([route, foreignRoute]),
          unsimplifiedRoute: structuredClone(route),
          connMap,
        })
        solver.solve()
        const optimizedRoute = solver.getOptimizedHdRoute()
        expect(solver.solved).toBe(true)
        expect(solver.failed).toBe(false)
        if (control === "blocked") {
          expect(optimizedRoute.route).toEqual(route.route)
          expect(optimizedRoute.vias).toEqual(route.vias)
        } else {
          expect(optimizedRoute.vias).toHaveLength(0)
          expect(optimizedRoute.route.every((point) => point.z === 0)).toBe(true)
        }
      }
    }
  }
})
