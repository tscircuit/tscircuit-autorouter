import { expect, test } from "bun:test"
import { solveWithProgress } from "../scripts/benchmark/benchmark-run-task"
import type { BenchmarkTask } from "../scripts/benchmark/benchmark-types"

test("routing metrics are collected only for emitted progress updates", async () => {
  const task: BenchmarkTask = {
    datasetName: "fixture-dataset",
    solverName: "FixturePipeline",
    scenarioName: "sample1",
    sampleNumber: 1,
    scenario: {} as BenchmarkTask["scenario"],
  }
  let stepCount = 0
  let routingMetricCollectionCount = 0
  let highDensityGrowthMetricCollectionCount = 0
  const phaseStartedAt = performance.now()
  const solver = {
    solved: false,
    failed: false,
    progress: 0,
    iterations: 0,
    currentPipelineStepIndex: 0,
    pipelineDef: [{ solverName: "portPointPathingSolver" }],
    startTimeOfPhase: { portPointPathingSolver: phaseStartedAt },
    timeSpentOnPhase: {},
    portPointPathingSolver: {
      getSolveGraphBenchmarkMetrics: () => {
        routingMetricCollectionCount++
        return undefined
      },
    },
    highDensityRouteSolver: {
      getHighDensityGrowthAttemptCount: () => {
        highDensityGrowthMetricCollectionCount++
        return 3
      },
    },
    step() {
      stepCount++
      this.iterations++
      this.progress = stepCount / 1_000
      if (stepCount === 1_000) this.solved = true
    },
  }
  const emittedProgress: unknown[] = []

  await solveWithProgress(task, solver, phaseStartedAt, {
    progressIntervalMs: 60_000,
    onProgress: (progress) => emittedProgress.push(progress),
  })

  expect(stepCount).toBe(1_000)
  expect(emittedProgress).toHaveLength(2)
  expect(emittedProgress).toEqual([
    expect.objectContaining({
      routingMetrics: {
        highDensityGrowthAttemptCount: { value: 3, status: "partial" },
      },
    }),
    expect.objectContaining({
      routingMetrics: {
        highDensityGrowthAttemptCount: { value: 3, status: "partial" },
      },
    }),
  ])
  expect(routingMetricCollectionCount).toBe(0)
  expect(highDensityGrowthMetricCollectionCount).toBe(2)
})
