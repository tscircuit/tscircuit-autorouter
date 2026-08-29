import { expect, test } from "bun:test"
import { negotiateBoundaryContracts } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/boundary-contract-negotiator"
import { buildHybridWorkerBoardContext, buildRegionJob } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/build-worker-messages"
import { DynamicRegionGraph } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/dynamic-region-graph"
import { planGlobalTopology } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/global-topology-planner"
import { TransactionalCopperStore } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import { createHybridRoutingTestProblem } from "./fixtures"

test("sends board geometry once and keeps subsequent region jobs reference-only", () => {
  const problem = createHybridRoutingTestProblem()
  const topologyPlan = planGlobalTopology({
    problem,
    maximumEstimatedMemoryBytesPerObject: 32 * 1024 * 1024,
  })
  const regionGraph = new DynamicRegionGraph({
    problem,
    topologyPlan,
    maximumRegionCount: 128,
    maximumMutationCount: 128,
    maximumMergeRegionCount: 8,
  }).getSnapshot()
  const routePlan = topologyPlan.routeObjectPlans[0]!
  const region = regionGraph.regions.find((candidate) =>
    candidate.routeObjectIds.includes(routePlan.routeObjectId),
  )!
  const copperSnapshot = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 16,
  }).getSnapshot()
  const context = buildHybridWorkerBoardContext({
    problem,
    copperSnapshot,
    contextId: "compact-message-test",
    boardContextVersion: 0,
  })
  const job = buildRegionJob({
    problem,
    routePlan,
    region,
    boundaryContracts: negotiateBoundaryContracts({
      problem,
      topologyPlan,
      regionGraph,
    }),
    copperSnapshot,
    maximumExpansions: 100_000,
    maximumActivationRings: 4,
    deterministicSeed: 17,
  })

  expect(context.geometry.length).toBeGreaterThan(0)
  expect(context.connectionRules.length).toBe(
    problem.compiledRules.connections.length,
  )
  expect(Object.hasOwn(job, "geometry")).toBe(false)
  expect(Object.hasOwn(job, "connectionRules")).toBe(false)
  expect(job.searches.every((search) => search.connectionRuleReference)).toBe(
    true,
  )
  expect(JSON.stringify(job).length).toBeLessThan(JSON.stringify(context).length)
})
