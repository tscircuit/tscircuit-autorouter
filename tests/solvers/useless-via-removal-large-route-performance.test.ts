import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("efficiently optimizes dense routes with 1,000+ points without quadratic timeout", () => {
  const P = 500
  const N = 500

  const routePoints: HighDensityRoute["route"] = []

  // previousSection: 500 points along layer 0
  for (let i = 0; i < P; i++) {
    routePoints.push({
      x: (i / (P - 1)) * 20,
      y: 0,
      z: 0,
    })
  }

  // currentSection: 4 points detour on layer 1 around an obstacle
  routePoints.push(
    { x: 20, y: 0, z: 1 },
    { x: 20, y: 1, z: 1 },
    { x: 22, y: 1, z: 1 },
    { x: 22, y: 0, z: 1 },
  )

  // nextSection: 500 points along layer 0
  for (let i = 0; i < N; i++) {
    routePoints.push({
      x: 22 + (i / (N - 1)) * 20,
      y: 0,
      z: 0,
    })
  }

  const route: HighDensityRoute = {
    connectionName: "dense_perf_net",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: routePoints,
    vias: [
      { x: 20, y: 0 },
      { x: 22, y: 0 },
    ],
  }

  // Obstacle on layer 0 blocking (20,1) -> (22,1), so currentSection cannot move to layer 0 directly,
  // but a direct shortcut along y=0 on layer 0 from (20,0) to (22,0) is clear.
  const obstacle: Obstacle = {
    type: "rect",
    layers: ["top"],
    __zLayers: [0],
    center: { x: 21, y: 1 },
    width: 1,
    height: 0.5,
    connectedTo: ["other_net"],
  }

  const startTime = performance.now()

  const solver = new SingleRouteUselessViaRemovalSolver({
    obstacleSHI: new ObstacleSpatialHashIndex("flatbush", [obstacle]),
    hdRouteSHI: new HighDensityRouteSpatialIndex([route]),
    unsimplifiedRoute: structuredClone(route),
    connMap: new ConnectivityMap({ net0: [route.connectionName] }),
  })

  solver.solve()

  const durationMs = performance.now() - startTime

  expect(solver.solved).toBe(true)
  expect(solver.stats.geometryShortcutsApplied).toBe(1)
  expect(solver.stats.viasRemovedByGeometryShortcuts).toBe(2)

  const optimizedRoute = solver.getOptimizedHdRoute()
  expect(optimizedRoute.vias).toHaveLength(0)
  expect(optimizedRoute.route.every((point) => point.z === 0)).toBe(true)

  // Must execute orders of magnitude faster than the unindexed quadratic approach (< 150ms)
  expect(durationMs).toBeLessThan(150)
})
