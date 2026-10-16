import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9EffortCleanupSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9EffortCleanupSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("cleanup retains a legal via reduction when another route fails validation", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "blocked",
      traceThickness: 0.15,
      viaDiameter: 0.4,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 0, z: 1 },
        { x: 3, y: 0, z: 1 },
        { x: 3, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
      ],
      vias: [{ x: 1, y: 0 }, { x: 3, y: 0 }],
    },
    {
      connectionName: "clear",
      traceThickness: 0.15,
      viaDiameter: 0.4,
      route: [
        { x: 0, y: 5, z: 0 },
        { x: 1, y: 5, z: 0 },
        { x: 1, y: 5, z: 1 },
        { x: 3, y: 5, z: 1 },
        { x: 3, y: 5, z: 0 },
        { x: 4, y: 5, z: 0 },
      ],
      vias: [{ x: 1, y: 5 }, { x: 3, y: 5 }],
    },
  ]
  const original = structuredClone(routes)
  const solver = new Pipeline9EffortCleanupSolver({
    effort: 1,
    config: {
      hdRoutes: routes,
      obstacles: [],
      connMap: new ConnectivityMap({ blocked: ["blocked"], clear: ["clear"] }),
      colorMap: {},
      defaultViaDiameter: 0.4,
      layerCount: 2,
      preserveRouteEndpoints: true,
    },
    getCost: (candidate) => ({
      vias: candidate.reduce((sum, route) => sum + route.vias.length, 0),
      points: candidate.reduce((sum, route) => sum + route.route.length, 0),
    }),
    isValid: (candidate) => candidate[0]!.vias.length === 2,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.getOutput()[0]).toEqual(original[0])
  expect(solver.getOutput()[1]!.vias).toHaveLength(0)
  expect(routes).toEqual(original)
})
