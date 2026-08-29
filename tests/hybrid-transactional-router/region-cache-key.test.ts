import { expect, test } from "bun:test"
import {
  createRegionCacheKey,
  HYBRID_REGION_SOLVER_VERSION,
} from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/content-addressed-region-cache"
import { buildRegionJob } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/build-worker-messages"
import { negotiateBoundaryContracts } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/boundary-contract-negotiator"
import { DynamicRegionGraph } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/dynamic-region-graph"
import { planGlobalTopology } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/global-topology-planner"
import { TransactionalCopperStore } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import { createHybridRoutingTestProblem } from "./fixtures"

test("keys every deterministic regional correctness input by content", () => {
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
  const boundaryContracts = negotiateBoundaryContracts({
    problem,
    topologyPlan,
    regionGraph,
  })
  const routePlan = topologyPlan.routeObjectPlans[0]
  if (!routePlan) throw new Error("fixture has no route plan")
  const region = regionGraph.regions.find((candidate) =>
    candidate.routeObjectIds.includes(routePlan.routeObjectId),
  )
  if (!region) throw new Error("fixture has no matching region")
  const copperSnapshot = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 4,
  }).getSnapshot()
  const createJob = (deterministicSeed: number) =>
    buildRegionJob({
      problem,
      routePlan,
      region,
      boundaryContracts,
      copperSnapshot,
      maximumExpansions: 250_000,
      maximumActivationRings: 4,
      deterministicSeed,
    })
  const job = createJob(17)
  const nativeKey = createRegionCacheKey({
    problem,
    region,
    routePlan,
    boundaryContracts,
    job,
    runtimeTarget: "native",
  })

  expect(HYBRID_REGION_SOLVER_VERSION).toBe("hybrid-regional-core-0.1.0")
  expect(
    createRegionCacheKey({
      problem,
      region,
      routePlan,
      boundaryContracts,
      job,
      runtimeTarget: "native",
    }),
  ).toBe(nativeKey)
  expect(
    createRegionCacheKey({
      problem,
      region,
      routePlan,
      boundaryContracts,
      job,
      runtimeTarget: "wasm",
    }),
  ).not.toBe(nativeKey)
  expect(
    createRegionCacheKey({
      problem,
      region,
      routePlan,
      boundaryContracts,
      job: createJob(18),
      runtimeTarget: "native",
    }),
  ).not.toBe(nativeKey)
})
