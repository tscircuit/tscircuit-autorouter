import { expect, test } from "bun:test"
import { negotiateBoundaryContracts } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/boundary-contract-negotiator"
import { EMPTY_REGION_CACHE_SNAPSHOT } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/content-addressed-region-cache"
import { DemandCapacityField } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/demand-capacity-field"
import { DynamicRegionGraph } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/dynamic-region-graph"
import { planGlobalTopology } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/global-topology-planner"
import type { SerialHybridEngineResult } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/serial-engine-types"
import { TransactionalCopperStore } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import { createHybridRoutingVisualizations } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/visualization"
import {
  createHybridRoutingTestFixture,
  createHybridRoutingTestProblem,
} from "./fixtures"

test("builds bounded inspectable graphics from actual planning artifacts", () => {
  const input = createHybridRoutingTestFixture().simpleRouteJson
  const problem = createHybridRoutingTestProblem()
  const topologyPlan = planGlobalTopology({
    problem,
    maximumEstimatedMemoryBytesPerObject: 32 * 1024 * 1024,
  })
  const copperSnapshot = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 4,
  }).getSnapshot()
  const regionGraph = new DynamicRegionGraph({
    problem,
    topologyPlan,
    maximumRegionCount: 128,
    maximumMutationCount: 128,
    maximumMergeRegionCount: 8,
  }).getSnapshot()
  const demandCapacityField = new DemandCapacityField({
    problem,
    topologyPlan,
    copperSnapshot,
    maximumCellCount: 100_000,
  }).getSnapshot()
  const engineResult: SerialHybridEngineResult = {
    status: "failed",
    message: "visualization fixture",
    artifacts: {
      topologyPlan,
      demandCapacityField,
      regionGraph,
      boundaryContracts: negotiateBoundaryContracts({
        problem,
        topologyPlan,
        regionGraph,
      }),
      copperSnapshot,
      attempts: [],
      cache: EMPTY_REGION_CACHE_SNAPSHOT,
    },
  }

  const visualizations = createHybridRoutingVisualizations({
    input,
    engineResult,
    maximumGraphicsObjects: 64,
  })

  expect(visualizations.map((visualization) => visualization.name)).toEqual([
    "global-topology",
    "demand-capacity",
    "dynamic-regions",
    "transaction-history",
    "final-route",
  ])
  expect(visualizations[0]?.graphics.lines?.length).toBeGreaterThan(0)
  expect(visualizations[1]?.graphics.rects?.length).toBeLessThanOrEqual(
    64 + input.obstacles.length,
  )
  expect(visualizations[2]?.graphics.rects?.length).toBeGreaterThan(0)
})
