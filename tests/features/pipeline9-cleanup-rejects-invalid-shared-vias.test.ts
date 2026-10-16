import { expect, test } from "bun:test"
import { convertRepairRoutesToTraces } from "@tscircuit/repair04"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9EffortCleanupSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9EffortCleanupSolver"
import { getPipeline9PhysicalViaCount } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalViaCount"
import { createSharedTerminalViaRoutes } from "tests/fixtures/shared-terminal-via-routes"

test("cleanup keeps separate terminal vias when board validation rejects sharing", (): void => {
  const routes = createSharedTerminalViaRoutes()
  let validationCount = 0
  const solver = new Pipeline9EffortCleanupSolver({
    effort: 1,
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
    isValid: () => {
      validationCount++
      return false
    },
  })

  solver.solve()

  expect(validationCount).toBeGreaterThan(0)
  expect(solver.getOutput()).toEqual(routes)
})
