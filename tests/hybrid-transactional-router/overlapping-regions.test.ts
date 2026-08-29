import { expect, test } from "bun:test"
import { DynamicRegionGraph } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/dynamic-region-graph"
import { planGlobalTopology } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/global-topology-planner"
import { createHybridRoutingTestProblem } from "./fixtures"

test("creates bounded overlapping regions with symmetric neighbor edges", () => {
  const problem = createHybridRoutingTestProblem()
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
  }).getSnapshot()

  expect(graph.regions).toHaveLength(topologyPlan.routeObjectPlans.length)
  expect(graph.regions.some((region) => region.neighboringRegionIds.length > 0)).toBe(
    true,
  )
  for (const region of graph.regions) {
    expect(region.maximumEnvelope.minX).toBeGreaterThanOrEqual(
      problem.compiledRules.boardBounds.minX,
    )
    for (const neighborId of region.neighboringRegionIds) {
      expect(
        graph.regions
          .find((candidate) => candidate.regionId === neighborId)
          ?.neighboringRegionIds.includes(region.regionId),
      ).toBe(true)
    }
  }
})
