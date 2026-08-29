import { expect, test } from "bun:test"
import { createDeterministicRegionSchedule } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/deterministic-region-scheduler"
import { DynamicRegionGraph } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/dynamic-region-graph"
import { planGlobalTopology } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/global-topology-planner"
import { createHybridRoutingTestProblem } from "./fixtures"

test("never schedules conflicting regions in the same deterministic wave", () => {
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
  const options = {
    regionGraph: graph,
    maximumConcurrency: 4,
    maximumWaveMemoryBytes: 64 * 1024 * 1024,
  }
  const first = createDeterministicRegionSchedule(options)
  const second = createDeterministicRegionSchedule(options)

  expect(first).toEqual(second)
  for (const wave of first) {
    for (const scheduled of wave.regions) {
      const region = graph.regions.find(
        (candidate) => candidate.regionId === scheduled.regionId,
      )!
      expect(
        wave.regions.some(
          (other) =>
            other.regionId !== scheduled.regionId &&
            region.conflictRegionIds.includes(other.regionId),
        ),
      ).toBe(false)
    }
  }
})
