import { expect, test } from "bun:test"
import { convertRepairRoutesToTraces } from "@tscircuit/repair04"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9EffortCleanupSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9EffortCleanupSolver"
import { getPipeline9PhysicalViaCount } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalViaCount"
import { createSharedTerminalViaRoutes } from "tests/fixtures/shared-terminal-via-routes"

test("cleanup shares a through via at a common terminal while preserving reversed endpoints", (): void => {
  const routes = createSharedTerminalViaRoutes()
  const original = structuredClone(routes)
  const solver = new Pipeline9EffortCleanupSolver({
    effort: 1,
    srj: {
      layerCount: 2,
      minTraceWidth: 0.15,
      bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
      connections: [],
      obstacles: [],
    },
    config: {
      hdRoutes: routes,
      obstacles: [],
      connMap: new ConnectivityMap({ net: ["branch-a", "branch-b"] }),
      colorMap: {},
      defaultViaDiameter: 0.5,
      layerCount: 2,
      preserveRouteEndpoints: true,
    },
    getCost: (candidate) => ({
      vias: getPipeline9PhysicalViaCount({
        traces: convertRepairRoutesToTraces(candidate, 2),
      }),
      points: candidate.reduce((sum, route) => sum + route.route.length, 0),
    }),
    isValid: () => true,
  })

  solver.solve()

  expect(solver.bestCost.vias).toBe(1)
  expect(solver.getOutput()[1]!.vias).toEqual([{ x: 1, y: 0 }])
  expect(solver.getOutput()[0]!.route[0]).toEqual(original[0]!.route[0])
  expect(solver.getOutput()[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1))
  expect(solver.getOutput()[1]!.route[0]).toEqual(original[1]!.route[0])
  expect(solver.getOutput()[1]!.route.at(-1)).toEqual(original[1]!.route.at(-1))
  expect(routes).toEqual(original)
})
