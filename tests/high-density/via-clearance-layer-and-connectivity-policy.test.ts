import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("whole-edge via checks retain all-layer and connected-via blocking policy", (): void => {
  const connMap = new ConnectivityMap({})
  connMap.addConnections([["signal", "connected-route"]])
  const obstacle: HighDensityIntraNodeRoute = {
    connectionName: "connected-route",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0.3, z: 0 },
      { x: 0, y: 0.3, z: 3 },
    ],
    vias: [{ x: 0, y: 0.3 }],
  }
  for (const z of [0, 1, 2, 3]) {
    const solver = new SingleHighDensityRouteSolver({
      connectionName: "signal",
      connMap,
      obstacleRoutes: [obstacle],
      minDistBetweenEnteringPoints: 4,
      bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
      A: { x: -4, y: 0, z },
      B: { x: 4, y: 0, z },
      traceThickness: 0.15,
      viaDiameter: 0.3,
      obstacleMargin: 0.15,
      layerCount: 4,
      availableZ: [0, 1, 2, 3],
      captureSearchDebug: false,
    })
    const start: Node = {
      x: -0.4,
      y: 0,
      z,
      g: 0,
      h: 0,
      f: 0,
      parent: null,
    }
    const end: Node = { ...start, x: 0.4, parent: start }
    const nearVia: Node = { ...start, x: 0, y: 0.3 }

    expect(connMap.areIdsConnected("signal", "connected-route")).toBe(true)
    expect(solver.isNodeTooCloseToObstacle(nearVia)).toBe(true)
    expect(solver.doesPathToParentIntersectObstacle(end)).toBe(true)
  }
})
