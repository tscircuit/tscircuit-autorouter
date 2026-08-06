import { expect, test } from "bun:test"
import { runTask } from "../scripts/benchmark/benchmark-run-task"
import type { WorkerProgress } from "../scripts/benchmark/benchmark-types"
import { loadScenarioBySampleNumber } from "../scripts/benchmark/scenarios"

test("benchmark worker results serialize portal refinement and phase diagnostics", async () => {
  const { scenario, scenarioName } = await loadScenarioBySampleNumber(
    "dataset01",
    1,
  )
  const progressUpdates: WorkerProgress[] = []
  const result = await runTask(
    {
      datasetName: "dataset01",
      solverName: "AutoroutingPipelineSolver7_MultiGraph",
      scenarioName,
      sampleNumber: 1,
      scenario,
    },
    {
      onProgress: (progress) => progressUpdates.push(progress),
      progressIntervalMs: 0,
    },
  )

  expect(result.didSolve).toBe(true)
  expect(result.benchmarkStats).toBeDefined()
  for (const statName of [
    "physicalPortalGroupCount",
    "eligibleRouteCount",
    "acceptedCandidateCount",
    "predictedViaDemandBefore",
    "predictedViaDemandAfter",
    "rejectedForIntersectionRegressionCount",
    "rejectedForNoViaDemandImprovementCount",
    "tinyHypergraphSolveMs",
    "tinyHypergraphSectionOptimizationMs",
    "portalLayerRefinementMs",
    "uniformPortDistributionMs",
    "highDensityRouteMs",
    "highDensityForceImproveMs",
    "highDensityRepairMs",
    "stitchingMs",
    "traceSimplificationMs",
    "traceWidthMs",
    "globalDrcMs",
    "exactDrcMs",
    "totalMs",
  ] as const) {
    expect(Number(result.benchmarkStats?.[statName])).toBeGreaterThanOrEqual(0)
    expect(
      Number(result.benchmarkSnapshot?.benchmarkStats?.[statName]),
    ).toBeGreaterThanOrEqual(0)
  }
  expect(result.highDensityViaCount).toBeGreaterThanOrEqual(0)
  expect(
    progressUpdates.at(-1)?.benchmarkStats.acceptedCandidateCount,
  ).toBeGreaterThanOrEqual(0)
  expect(progressUpdates.at(-1)?.highDensityViaCount).toBeGreaterThanOrEqual(0)
  expect(JSON.parse(JSON.stringify(result)).benchmarkStats).toEqual(
    result.benchmarkStats,
  )
})
