import { expect, test } from "bun:test"
import type { TinyHyperGraphSectionPipelineInput, TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import input from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"

type TinyPipelineTestHarness = {
  inputProblem: TinyHyperGraphSectionPipelineInput
  getInitialVisualizationSolver(): TinyHyperGraphSolver
}

type TinyHypergraphParams = ConstructorParameters<
  typeof TinyHypergraphPortPointPathingSolver
>[0]

test("the wrapper initializes route order only for selective routing with partial rips enabled", (): void => {
  for (const selectiveRerips of [false, true]) {
    for (const partialRips of [false, true]) {
      const params = structuredClone(input) as TinyHypergraphParams
      params.flags.USE_SELECTIVE_RERIP_ROUTING = selectiveRerips
      const outer = new TinyHypergraphPortPointPathingSolver(params)
      const pipeline = (
        outer as unknown as { tinyPipelineSolver: TinyPipelineTestHarness }
      ).tinyPipelineSolver
      // Exercise the real wrapper's solver configuration without constructing
      // a large board. These are the options already supplied for eligible
      // partial-rip graphs, with the flag explicitly toggled for this check.
      Object.assign(pipeline.inputProblem.solveGraphOptions!, {
        PARTIAL_RIP_ENABLED: partialRips,
        PARTIAL_RIP_MIN_ROUTE_COUNT: 0,
        PARTIAL_RIP_MAX_ROUTE_COUNT: Number.POSITIVE_INFINITY,
      })
      const tiny = pipeline.getInitialVisualizationSolver()
      expect(tiny.PARTIAL_RIP_ENABLED).toBe(partialRips)
      expect(tiny.iterations).toBe(0)
      expect(tiny.state.unroutedRoutes).toEqual([0])
      expect(tiny.state.regionCongestionCost.every((cost) => cost === 0)).toBeTrue()
      expect(tiny.state.regionSegments.every((segments) => segments.length === 0)).toBeTrue()
      if (selectiveRerips && partialRips) {
        expect(tiny.stats.initialRouteOrderingRouteCount).toBe(1)
      } else {
        expect(tiny.stats.initialRouteOrderingRouteCount).toBeUndefined()
      }
      const statsAfterConfiguration = tiny.stats
      expect(pipeline.getInitialVisualizationSolver()).toBe(tiny)
      expect(tiny.stats).toBe(statsAfterConfiguration)
    }
  }
})
