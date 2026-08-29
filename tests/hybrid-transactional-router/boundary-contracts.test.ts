import { expect, test } from "bun:test"
import { negotiateBoundaryContracts } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/boundary-contract-negotiator"
import { DynamicRegionGraph } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/dynamic-region-graph"
import { planGlobalTopology } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/global-topology-planner"
import { createHybridRoutingTestProblem } from "./fixtures"

test("derives versioned boundary reserves and stable coupled crossing order", () => {
  const problem = createHybridRoutingTestProblem()
  const topologyPlan = planGlobalTopology({
    problem,
    maximumEstimatedMemoryBytesPerObject: 16 * 1024 * 1024,
  })
  const regionGraph = new DynamicRegionGraph({
    problem,
    topologyPlan,
    maximumRegionCount: 16,
    maximumMutationCount: 8,
    maximumMergeRegionCount: 3,
  }).getSnapshot()

  const contracts = negotiateBoundaryContracts({
    problem,
    topologyPlan,
    regionGraph,
  })

  expect(contracts.length).toBeGreaterThan(0)
  expect(
    contracts.every(
      (contract) =>
        contract.version === regionGraph.graphVersion &&
        contract.legalReserveMm >= problem.compiledRules.viaPadDiameterMm,
    ),
  ).toBe(true)
  for (const contract of contracts) {
    expect(contract.crossings.map((crossing) => crossing.order)).toEqual(
      contract.crossings.map((_, index) => index),
    )
  }
})
