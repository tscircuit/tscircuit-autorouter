import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("via shortcuts preserve width anchors and simplify unrelated uniform copper", (): void => {
  for (const detour of [false, true]) {
    for (const taper of ["inside", "outside", "none"]) {
      const route: HighDensityRoute = {
        connectionName: "width_aware_shortcut",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: 0, z: 0, traceThickness: 0.15 },
          { x: 1, y: 0, z: 0, traceThickness: 0.15 },
          { x: 1, y: 0, z: 1, traceThickness: 0.15 },
          {
            x: 1,
            y: 1,
            z: 1,
            traceThickness: taper === "inside" ? 0.3 : 0.15,
          },
          {
            x: 3,
            y: 1,
            z: 1,
            traceThickness: taper === "inside" ? 0.3 : 0.15,
          },
          { x: 3, y: 0, z: 1, traceThickness: 0.15 },
          { x: 3, y: 0, z: 0, traceThickness: 0.15 },
          { x: 4, y: 0.5, z: 0, traceThickness: 0.15 },
        ],
        vias: [
          { x: 1, y: 0 },
          { x: 3, y: 0 },
        ],
      }
      if (taper === "outside") {
        route.route.unshift(
          { x: -2, y: 0, z: 0, traceThickness: 0.1 },
          { x: -1, y: 0, z: 0, traceThickness: 0.1 },
        )
      }
      const obstacle: Obstacle = {
        type: "rect",
        layers: ["top"],
        __zLayers: [0],
        center: { x: 2, y: 1 },
        width: 1,
        height: 0.5,
        connectedTo: ["other_net"],
      }
      const solver: SingleRouteUselessViaRemovalSolver =
        new SingleRouteUselessViaRemovalSolver({
          obstacleSHI: new ObstacleSpatialHashIndex("flatbush", [obstacle]),
          hdRouteSHI: new HighDensityRouteSpatialIndex([route]),
          unsimplifiedRoute: structuredClone(route),
          connMap: new ConnectivityMap({ route_net: [route.connectionName] }),
          enableGeometryShortcuts: !detour,
          enableObstacleDetourShortcuts: detour,
        })
      solver.solve()
      const optimizedRoute: HighDensityRoute = solver.getOptimizedHdRoute()
      expect(solver.solved).toBe(true)
      expect(solver.failed).toBe(false)
      if (taper === "inside") {
        expect(optimizedRoute.route).toEqual(route.route)
        expect(optimizedRoute.vias).toEqual(route.vias)
      } else {
        expect(optimizedRoute.vias).toHaveLength(0)
        expect(solver.stats.viasRemovedByGeometryShortcuts).toBe(2)
        if (taper === "outside") {
          expect(optimizedRoute.route.slice(0, 3)).toEqual(
            route.route.slice(0, 3),
          )
        }
        expect(
          optimizedRoute.route
            .slice(taper === "outside" ? 2 : 0)
            .every((point) => point.traceThickness === route.traceThickness),
        ).toBe(true)
      }
    }
  }
})
