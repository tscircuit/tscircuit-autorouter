import { expect, test } from "bun:test"
import input from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { createFeasibleOwnerCorridorController } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/createFeasibleOwnerCorridorController"
import type { SelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/index"

test("cold feasible UNKNOWN remains explicit and invokes only the existing native budget response", (): void => {
  const params = structuredClone(input) as ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0]
  params.flags.USE_SELECTIVE_RERIP_ROUTING = true
  const adapter = new TinyHypergraphPortPointPathingSolver(params)
  const pipeline = (adapter as unknown as { tinyPipelineSolver: { getInitialVisualizationSolver(): SelectiveReripTinyHyperGraphSolver } }).tinyPipelineSolver
  const native = pipeline.getInitialVisualizationSolver(), controller = createFeasibleOwnerCorridorController(0)
  controller.install(native); controller.install(native)
  native.state.currentRouteId = 0
  native.state.currentRouteNetId = native.problem.routeNet[0]!
  const query = native as unknown as { findRelaxedBlockerPath(): { found: boolean; reason?: string; expandedLabelCount: number } }
  expect(query.findRelaxedBlockerPath()).toEqual({ found: false, reason: "expansion_limit", expandedLabelCount: 0 })
  expect(controller.stats.feasibleOwner_installedSelectiveSolvers).toBe(1)
  expect(controller.stats.feasibleOwner_unknown).toBe(1)
  expect(controller.stats.feasibleOwner_oldSearchCalls).toBe(0)
  expect(controller.stats.feasibleOwner_coldOwnerScans).toBe(0)
  native.onOutOfCandidates()
  expect(native.getSelectiveReripStats().globalReripReason).toBe("expansion_limit")
  expect(native.getSelectiveReripStats().globalReripCount).toBe(1)
  expect(controller.stats.feasibleOwner_unknown).toBe(2)
  expect(controller.stats.feasibleOwner_noPath).toBe(0)
  expect(controller.stats.feasibleOwner_oldSearchCalls).toBe(0)
  expect(() => createFeasibleOwnerCorridorController(300000001)).toThrow("fixed work cap")
})
