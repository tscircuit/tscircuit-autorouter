import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9EffortCleanupSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9EffortCleanupSolver"
import { createCrossingViaReductionRoutes } from "tests/fixtures/crossing-via-reduction-routes"

test("post-repair cleanup commits only valid improvements and preserves its input", (): void => {
  for (const isValid of [false, true]) {
    const input = createCrossingViaReductionRoutes()
    const original = structuredClone(input)
    const counts: number[] = []
    for (const effort of [0.1, 1, 1.5, 2]) {
      let validityChecks = 0
      const solver = new Pipeline9EffortCleanupSolver({
        effort,
        config: {
          hdRoutes: input,
          obstacles: [],
          connMap: new ConnectivityMap({
            detour_net: ["detour"],
            transition_net: ["transition"],
          }),
          colorMap: {},
          defaultViaDiameter: 0.4,
          layerCount: 2,
          enableCrossingViaReduction: true,
        },
        getCost: (routes) => ({
          vias: routes.reduce((sum, route) => sum + route.vias.length, 0),
          points: routes.reduce((sum, route) => sum + route.route.length, 0),
        }),
        isValid: () => {
          validityChecks++
          return isValid
        },
      })
      solver.solve()
      expect(solver.failed).toBe(false)
      expect(solver.completedPasses).toBe(
        effort <= 1 ? (isValid ? 2 : 1) : Math.ceil(2 * effort),
      )
      expect(solver.MAX_ITERATIONS).toBe(
        100e6 * (effort <= 1 ? 1 : Math.ceil(2 * effort)),
      )
      if (effort <= 1) {
        expect(validityChecks).toBe(1)
        expect(solver.simplifier).toBeUndefined()
      }
      counts.push(solver.bestCost.vias)
      if (!isValid) expect(solver.getOutput()).toEqual(original)
      expect(input).toEqual(original)
    }
    expect(counts[1]).toBeLessThanOrEqual(counts[0])
    expect(counts[2]).toBeLessThanOrEqual(counts[1])
    expect(counts[3]).toBeLessThanOrEqual(counts[2])
    if (isValid) {
      expect(counts[0]).toBeLessThan(
        original.reduce((sum, route) => sum + route.vias.length, 0),
      )
    }
  }
})
