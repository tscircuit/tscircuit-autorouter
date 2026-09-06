import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type RoutePoint = HighDensityRoute["route"][number]

test("direct via shortcuts check invariant middle widths before anchor pairs", (): void => {
  for (const anchorCount of [8, 16]) {
    for (const protectedWidth of [false, true]) {
      const leftViaX: number = (anchorCount - 1) / anchorCount
      const middleWidth: number = protectedWidth ? 0.2 : 0.1
      const middlePoints: RoutePoint[] = [
        { x: leftViaX, y: 0, z: 1, traceThickness: 0.1 },
        { x: leftViaX, y: 1, z: 1, traceThickness: middleWidth },
        { x: 3, y: 1, z: 1, traceThickness: middleWidth },
        { x: 3, y: 0, z: 1, traceThickness: 0.1 },
      ]
      const route: HighDensityRoute = {
        connectionName: "shortcut_with_middle_width",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          ...Array.from(
            { length: anchorCount },
            (_: unknown, index: number): RoutePoint => ({
              x: index / anchorCount,
              y: 0,
              z: 0,
              traceThickness: 0.1,
            }),
          ),
          ...middlePoints,
          ...Array.from(
            { length: anchorCount },
            (_: unknown, index: number): RoutePoint => ({
              x: 3 + index / anchorCount,
              y: 0,
              z: 0,
              traceThickness: 0.1,
            }),
          ),
        ],
        vias: [
          { x: leftViaX, y: 0 },
          { x: 3, y: 0 },
        ],
      }
      const originalRoute: HighDensityRoute = structuredClone(route)
      let widthReads: number = 0
      route.route[anchorCount + 1] = new Proxy(middlePoints[1]!, {
        get(
          point: RoutePoint,
          property: string | symbol,
          receiver: unknown,
        ): unknown {
          if (property === "traceThickness") {
            widthReads++
          }
          return Reflect.get(point, property, receiver)
        },
      })
      const obstacle: Obstacle = {
        type: "rect",
        layers: ["top"],
        __zLayers: [0],
        center: { x: 2, y: 1 },
        width: 0.5,
        height: 0.5,
        connectedTo: ["foreign_net"],
      }
      const solver: SingleRouteUselessViaRemovalSolver =
        new SingleRouteUselessViaRemovalSolver({
          obstacleSHI: new ObstacleSpatialHashIndex("flatbush", [obstacle]),
          hdRouteSHI: new HighDensityRouteSpatialIndex([route]),
          unsimplifiedRoute: route,
          connMap: new ConnectivityMap({ net: [route.connectionName] }),
          preserveRouteEndpoints: true,
        })
      widthReads = 0
      solver.solve()
      const solveWidthReads: number = widthReads
      const optimizedRoute: HighDensityRoute = solver.getOptimizedHdRoute()
      expect(solver.solved).toBe(true)
      expect(solver.failed).toBe(false)
      expect(route).toEqual(originalRoute)
      if (protectedWidth) {
        expect(optimizedRoute.route).toEqual(originalRoute.route)
        expect(optimizedRoute.vias).toEqual(originalRoute.vias)
        expect(solveWidthReads).toBeLessThanOrEqual(middlePoints.length)
      } else {
        expect(optimizedRoute.vias).toHaveLength(0)
        expect(optimizedRoute.route).toEqual([
          originalRoute.route[0]!,
          ...originalRoute.route.slice(anchorCount + middlePoints.length),
        ])
      }
    }
  }
})
