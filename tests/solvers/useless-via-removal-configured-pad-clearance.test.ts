import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("basic via removal honors declared pad clearance without changing its default", (): void => {
  for (const configuredMargin of [undefined, 0.3]) {
    for (const separation of [0.225, 0.45]) {
      const route: HighDensityRoute = {
        connectionName: "moving_wire",
        traceThickness: 0.2,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 1, y: 0, z: 1 },
          { x: 3, y: 0, z: 1 },
          { x: 3, y: 0, z: 0 },
          { x: 4, y: 0, z: 0 },
        ],
        vias: [{ x: 1, y: 0 }, { x: 3, y: 0 }],
      }
      const foreignPad: Obstacle = {
        type: "rect",
        layers: ["top"],
        __zLayers: [0],
        center: { x: 2, y: separation + 0.1 },
        width: 0.4,
        height: 0.2,
        connectedTo: ["foreign_pad"],
      }
      const solver = new SingleRouteUselessViaRemovalSolver({
        obstacleSHI: new ObstacleSpatialHashIndex("flatbush", [foreignPad]),
        hdRouteSHI: new HighDensityRouteSpatialIndex([route]),
        unsimplifiedRoute: structuredClone(route),
        connMap: new ConnectivityMap({ route_net: [route.connectionName] }),
        geometryShortcutObstacleMargin: configuredMargin,
      })
      solver.solve()
      const optimizedRoute = solver.getOptimizedHdRoute()
      expect(solver.solved).toBe(true)
      expect(solver.failed).toBe(false)
      const replay = new SingleRouteUselessViaRemovalSolver(
        solver.getConstructorParams(),
      )
      replay.solve()
      expect(replay.getOptimizedHdRoute()).toEqual(optimizedRoute)
      if (
        configuredMargin !== undefined &&
        separation < route.traceThickness / 2 + configuredMargin
      ) {
        expect(optimizedRoute.route).toEqual(route.route)
        expect(optimizedRoute.vias).toEqual(route.vias)
      } else {
        expect(optimizedRoute.vias).toHaveLength(0)
        expect(optimizedRoute.route.every((point) => point.z === 0)).toBe(true)
      }
    }
  }
})
