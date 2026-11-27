import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9EffortCleanupSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9EffortCleanupSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createCrossingViaReductionRoutes } from "tests/fixtures/crossing-via-reduction-routes"

function makeIndependentCrossings(): HighDensityRoute[] {
  return ["clear", "rejected", "protected"].flatMap((name, index) =>
    createCrossingViaReductionRoutes().map((route) => ({
      ...route,
      connectionName: `${name}-${route.connectionName}`,
      route: route.route.map((point) => ({
        ...point,
        x: point.x + 20 * index,
        ...(point.pcb_port_id && { pcb_port_id: `${name}-${point.pcb_port_id}` }),
      })),
      vias: route.vias.map((via) => ({ ...via, x: via.x + 20 * index })),
    })),
  )
}

test("via optimization retains independently valid reductions", (): void => {
  const routes = makeIndependentCrossings()
  const input = structuredClone(routes)
  const solver = new Pipeline9EffortCleanupSolver({
    effort: 1,
    viaOptimization: {
      protectedConnectionNames: new Set(["protected-detour"]),
    },
    config: {
      hdRoutes: routes,
      obstacles: [],
      connMap: new ConnectivityMap({}),
      colorMap: {},
      defaultViaDiameter: 0.4,
      layerCount: 2,
      enableCrossingViaReduction: true,
      preserveRouteEndpoints: true,
    },
    getCost: (candidate) => ({
      vias: candidate.reduce((sum, route) => sum + route.vias.length, 0),
      points: candidate.reduce((sum, route) => sum + route.route.length, 0),
    }),
    isValid: (candidate) =>
      candidate.find((route) => route.connectionName === "rejected-detour")!
        .vias.length === 2,
  })
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.getOutput().map((route) => route.vias.length)).toEqual([
    0, 1, 2, 1, 2, 1,
  ])
  for (const [index, route] of solver.getOutput().entries()) {
    expect(route.route[0]).toEqual(input[index]!.route[0])
    expect(route.route.at(-1)).toEqual(input[index]!.route.at(-1))
  }
  expect(routes).toEqual(input)
})
