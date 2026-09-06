import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { canSectionMoveToLayer } from "lib/solvers/UselessViaRemovalSolver/can-section-move-to-layer"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("section clearance respects via copper on endpoint and intermediate layers", (): void => {
  for (const traceThickness of [0.2, 0.5]) {
    for (const targetZ of [0, 1, 2]) {
      for (const traceMargin of [0, 0.1]) {
        for (const control of ["blocked", "clear", "same-net"]) {
          const route: HighDensityRoute = {
            connectionName: "moving_wire",
            traceThickness,
            viaDiameter: 0.3,
            route: [
              { x: 0, y: 0, z: targetZ },
              { x: 4, y: 0, z: targetZ },
            ],
            vias: [],
          }
          const viaDiameter = 0.6
          const requiredSeparation =
            traceThickness / 2 + viaDiameter / 2 + traceMargin
          const separation =
            requiredSeparation + (control === "clear" ? 0.05 : -0.05)
          const foreignRoute: HighDensityRoute = {
            connectionName: "plated_via",
            traceThickness: 0.1,
            viaDiameter,
            route: [
              { x: 2, y: separation, z: 0 },
              { x: 2, y: separation, z: 2 },
            ],
            vias: [{ x: 2, y: separation }],
          }
          const connMap = new ConnectivityMap({
            route_net: [route.connectionName],
            foreign_net: [foreignRoute.connectionName],
          })
          if (control === "same-net") {
            connMap.addConnections([
              [route.connectionName, foreignRoute.connectionName],
            ])
          }
          const canMove = canSectionMoveToLayer({
            currentSection: {
              points: route.route,
              startIndex: 0,
              endIndex: 1,
              z: targetZ,
            },
            targetZ,
            route,
            hdRouteSHI: new HighDensityRouteSpatialIndex([route, foreignRoute]),
            obstacleSHI: new ObstacleSpatialHashIndex("flatbush", []),
            connMap,
            defaultTraceThickness: 0.15,
            obstacleMargin: 0.1,
            traceMargin,
          })
          expect(canMove).toBe(control !== "blocked")
        }
      }
    }
  }
})
