import { expect, test } from "bun:test"
import { convertRepairRoutesToTraces } from "@tscircuit/repair04"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9EffortCleanupSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9EffortCleanupSolver"
import { getPipeline9PhysicalViaCount } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalViaCount"
import { createSharedTerminalViaRoutes } from "tests/fixtures/shared-terminal-via-routes"

test("cleanup does not coalesce blind and buried terminal vias", (): void => {
  const routes = createSharedTerminalViaRoutes()
  const solver = new Pipeline9EffortCleanupSolver({
    effort: 1,
    allowBlindAndBuriedVias: true,
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
        allowBlindAndBuriedVias: true,
      }),
      points: candidate.reduce((sum, route) => sum + route.route.length, 0),
    }),
    isValid: () => true,
  })

  solver.solve()

  expect(solver.bestCost.vias).toBe(2)
  expect(solver.getOutput()).toEqual(routes)
})
