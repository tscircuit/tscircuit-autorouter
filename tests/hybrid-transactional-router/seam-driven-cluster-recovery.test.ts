import { expect, test } from "bun:test"
import { buildTypedRoutingProblem } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/build-typed-routing-problem"
import { compileRoutingRules } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/compile-routing-rules"
import { DynamicRegionGraph } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/dynamic-region-graph"
import { planGlobalTopology } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/global-topology-planner"
import { createHybridRoutingTestFixture } from "./fixtures"

test("merges only the shared-copper failing cluster and keeps the rest regional", () => {
  const { simpleRouteJson, routingRules } = createHybridRoutingTestFixture()
  const problem = buildTypedRoutingProblem(
    compileRoutingRules({
      simpleRouteJson,
      routingRules: {
        ...routingRules,
        preloadedCopperOwnership: [
          {
            pcbTraceId: "preloaded_signal_plain",
            mutability: "mutable",
            ownerConnectionNames: ["signal_plain", "bus_0"],
          },
        ],
      },
    }),
  )
  const topologyPlan = planGlobalTopology({
    problem,
    maximumEstimatedMemoryBytesPerObject: 16 * 1024 * 1024,
  })
  const graph = new DynamicRegionGraph({
    problem,
    topologyPlan,
    maximumRegionCount: 16,
    maximumMutationCount: 8,
    maximumMergeRegionCount: 3,
  })
  const [cluster] = graph.getSeamDrivenClusters()
  expect(cluster).toBeDefined()
  if (!cluster) return

  const recovered = graph.mergeConnectionCluster({
    regionIds: cluster,
    failingConnectionNames: ["signal_plain"],
  })

  expect(recovered.mergeCount).toBe(1)
  expect(recovered.regions).toHaveLength(topologyPlan.routeObjectPlans.length - 1)
  expect(recovered.regions.some((region) => region.routeObjectIds.length === 2)).toBe(
    true,
  )
})
