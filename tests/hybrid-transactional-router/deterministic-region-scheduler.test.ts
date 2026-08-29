import { expect, test } from "bun:test"
import { createDeterministicRegionSchedule } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/deterministic-region-scheduler"
import { DynamicRegionGraph } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/dynamic-region-graph"
import { planGlobalTopology } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/global-topology-planner"
import { createHybridRoutingTestProblem } from "./fixtures"

test("keeps region colors and commit order independent of worker concurrency", () => {
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
  const serialSchedule = createDeterministicRegionSchedule({
    regionGraph,
    maximumConcurrency: 1,
    maximumWaveMemoryBytes: 128 * 1024 * 1024,
  })
  const parallelSchedule = createDeterministicRegionSchedule({
    regionGraph,
    maximumConcurrency: 4,
    maximumWaveMemoryBytes: 128 * 1024 * 1024,
  })
  const flatten = (
    schedule: ReturnType<typeof createDeterministicRegionSchedule>,
  ) =>
    schedule.flatMap((wave) =>
      wave.regions.map((region) => ({
        regionId: region.regionId,
        color: region.color,
      })),
    )

  expect(flatten(parallelSchedule)).toEqual(flatten(serialSchedule))
  expect(
    parallelSchedule.every((wave) =>
      wave.regions.every(
        (first, firstIndex) =>
          !wave.regions.slice(firstIndex + 1).some((second) => {
            const firstRegion = regionGraph.regions.find(
              (region) => region.regionId === first.regionId,
            )!
            const secondRegion = regionGraph.regions.find(
              (region) => region.regionId === second.regionId,
            )!
            return (
              firstRegion.conflictRegionIds.includes(second.regionId) ||
              secondRegion.conflictRegionIds.includes(first.regionId)
            )
          }),
      ),
    ),
  ).toBe(true)
})
