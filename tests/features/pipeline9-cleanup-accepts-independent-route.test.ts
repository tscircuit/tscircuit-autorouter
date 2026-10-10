import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9EffortCleanupSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9EffortCleanupSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("cleanup accepts a valid shortcut while preserving a rejected route", (): void => {
  const detour: HighDensityRoute = {
    connectionName: "detour",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 2, y: 1, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
    ],
  }
  const unchangedRoute: HighDensityRoute = {
    ...detour,
    connectionName: "unchanged",
    route: detour.route.map((point) => ({ ...point, y: point.y + 5 })),
  }
  const solver = new Pipeline9EffortCleanupSolver({
    effort: 1,
    config: {
      hdRoutes: [detour, unchangedRoute],
      obstacles: [],
      connMap: new ConnectivityMap({}),
      colorMap: {},
      defaultViaDiameter: 0.3,
      layerCount: 2,
      preserveRouteEndpoints: true,
      useTraceWidthAwareClearance: true,
      enableVertexShortcuts: true,
    },
    getCost: (routes) => ({
      vias: routes.reduce((sum, route) => sum + route.vias.length, 0),
      points: routes.reduce((sum, route) => sum + route.route.length, 0),
    }),
    isValid: (routes) => Bun.deepEquals(routes[1], unchangedRoute),
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.getOutput()[0]!.route.length).toBeLessThan(detour.route.length)
  expect(solver.getOutput()[1]).toEqual(unchangedRoute)
})
