import { expect, test } from "bun:test"
import input from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { createFeasibleOwnerCorridorController } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/createFeasibleOwnerCorridorController"
import type { SelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/index"

test("synchronous native final children use feasible policy immediately and modified native authority is rejected", (): void => {
  const params = structuredClone(input) as ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0]
  params.flags.USE_SELECTIVE_RERIP_ROUTING = true
  const adapter = new TinyHypergraphPortPointPathingSolver(params)
  const pipeline = (adapter as unknown as { tinyPipelineSolver: { getInitialVisualizationSolver(): SelectiveReripTinyHyperGraphSolver } }).tinyPipelineSolver
  const parent = pipeline.getInitialVisualizationSolver(), controller = createFeasibleOwnerCorridorController(0)
  controller.install(parent)
  const access = parent as unknown as { createGreedyFinalRouteSolver(options: object, attempt: number): SelectiveReripTinyHyperGraphSolver }
  const child = access.createGreedyFinalRouteSolver({}, -1)
  child.state.currentRouteId = 0; child.state.currentRouteNetId = child.problem.routeNet[0]!
  const query = child as unknown as { findRelaxedBlockerPath(): { found: boolean; reason: string } }
  expect(query.findRelaxedBlockerPath().reason).toBe("expansion_limit")
  expect(controller.stats.feasibleOwner_installedSelectiveSolvers).toBe(2)
  expect(controller.stats.feasibleOwner_unknown).toBe(1)
  const other = new TinyHypergraphPortPointPathingSolver(structuredClone(params))
  const otherPipeline = (other as unknown as { tinyPipelineSolver: { getInitialVisualizationSolver(): SelectiveReripTinyHyperGraphSolver } }).tinyPipelineSolver
  const unsupported = otherPipeline.getInitialVisualizationSolver()
  let calls = 0
  const custom = unsupported as unknown as { getRelaxedSearchHops(): unknown[] }
  custom.getRelaxedSearchHops = (): unknown[] => { calls++; return [] }
  expect(() => createFeasibleOwnerCorridorController().install(unsupported)).toThrow("getRelaxedSearchHops")
  const changed = child as unknown as { getRelaxedSearchHops(): unknown[] }
  changed.getRelaxedSearchHops = (): unknown[] => { calls++; return [] }
  expect(() => query.findRelaxedBlockerPath()).toThrow("native authority changed")
  expect(calls).toBe(0)
  expect(controller.stats.feasibleOwner_queries).toBe(1)
  expect(controller.stats.feasibleOwner_oldSearchCalls).toBe(0)
  const nested = new TinyHypergraphPortPointPathingSolver(structuredClone(params))
  const nestedPipeline = (nested as unknown as { tinyPipelineSolver: { getInitialVisualizationSolver(): SelectiveReripTinyHyperGraphSolver } }).tinyPipelineSolver
  const customNested = nestedPipeline.getInitialVisualizationSolver() as unknown as { getHardBlockedCrossingOwners(): number[] }
  customNested.getHardBlockedCrossingOwners = (): number[] => { calls++; return [] }
  expect(() => createFeasibleOwnerCorridorController().install(customNested as unknown as SelectiveReripTinyHyperGraphSolver)).toThrow("getHardBlockedCrossingOwners")
  expect(calls).toBe(0)
})
