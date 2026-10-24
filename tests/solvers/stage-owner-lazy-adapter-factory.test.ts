import { expect, test } from "bun:test"
import input from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { createLazyOwnerReleaseController } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/createLazyOwnerReleaseController"
import type { SelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/index"

test("native synchronous congestion-aware final child is installed before use and custom authority rejects", (): void => {
  const params = structuredClone(input) as ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0]
  params.flags.USE_SELECTIVE_RERIP_ROUTING = true
  const adapter = new TinyHypergraphPortPointPathingSolver(params)
  const pipeline = (adapter as unknown as { tinyPipelineSolver: { getInitialVisualizationSolver(): SelectiveReripTinyHyperGraphSolver } }).tinyPipelineSolver
  const parent = pipeline.getInitialVisualizationSolver()
  const controller = createLazyOwnerReleaseController(0)
  controller.install(parent)
  const access = parent as unknown as { createGreedyFinalRouteSolver(options: object, attempt: number): SelectiveReripTinyHyperGraphSolver }
  const child = access.createGreedyFinalRouteSolver({}, -1)
  child.state.currentRouteId = 0; child.state.currentRouteNetId = child.problem.routeNet[0]!
  const query = child as unknown as { findRelaxedBlockerPath(): { found: boolean; reason: string } }
  expect(query.findRelaxedBlockerPath().reason).toBe("expansion_limit")
  expect(controller.stats.lazyOwnerRelease_installedSelectiveSolvers).toBe(2)
  expect(controller.stats.lazyOwnerRelease_unknown).toBe(1)
  expect(controller.stats.lazyOwnerRelease_oldSearchCalls).toBe(0)
  const unsupportedAdapter = new TinyHypergraphPortPointPathingSolver(structuredClone(params))
  const unsupportedPipeline = (unsupportedAdapter as unknown as { tinyPipelineSolver: { getInitialVisualizationSolver(): SelectiveReripTinyHyperGraphSolver } }).tinyPipelineSolver
  const unsupported = unsupportedPipeline.getInitialVisualizationSolver()
  const custom = unsupported as unknown as { getRelaxedSearchHops(): unknown[] }
  let customCalls = 0
  custom.getRelaxedSearchHops = (): unknown[] => { customCalls++; return [] }
  expect(() => createLazyOwnerReleaseController().install(unsupported)).toThrow("getRelaxedSearchHops")
  expect(customCalls).toBe(0)
  const changedChild = child as unknown as { getRelaxedSearchHops(): unknown[] }
  changedChild.getRelaxedSearchHops = (): unknown[] => { customCalls++; return [] }
  expect(() => query.findRelaxedBlockerPath()).toThrow("authority changed after installation")
  expect(customCalls).toBe(0)
  expect(controller.stats.lazyOwnerRelease_queries).toBe(1)
})
