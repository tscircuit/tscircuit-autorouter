import { expect, test } from "bun:test"
import { createFailedResult } from "../scripts/benchmark/index"
import type {
  BenchmarkTask,
  WorkerProgress,
} from "../scripts/benchmark/benchmark-types"

test("timeout and crash results retain the latest partial stage timing", () => {
  const task: BenchmarkTask = {
    datasetName: "fixture-dataset",
    solverName: "FixturePipeline",
    scenarioName: "sample1",
    sampleNumber: 1,
    scenario: {} as BenchmarkTask["scenario"],
  }
  const latestProgress: WorkerProgress = {
    solverName: task.solverName,
    scenarioName: task.scenarioName,
    sampleNumber: task.sampleNumber,
    elapsedTimeMs: 100,
    phaseName: "routeSolver",
    stageTiming: {
      status: "partial",
      stages: [
        { stageName: "preprocessSolver", elapsedTimeMs: 20 },
        { stageName: "routeSolver", elapsedTimeMs: 60 },
      ],
    },
    routingMetrics: {
      highDensityGrowthCount: 4,
    },
  }

  const timedOut = createFailedResult(
    task,
    150,
    "Timed out",
    true,
    latestProgress,
  )
  expect(timedOut.didTimeout).toBeTrue()
  expect(timedOut.stageTiming).toEqual({
    status: "partial",
    stages: [
      { stageName: "preprocessSolver", elapsedTimeMs: 20 },
      { stageName: "routeSolver", elapsedTimeMs: 110 },
    ],
  })
  expect(timedOut.routingMetrics?.highDensityGrowthCount).toBe(4)

  const crashed = createFailedResult(task, 140, "Child crashed", false, {
    ...latestProgress,
    phaseName: "unreportedNextSolver",
  })
  expect(crashed.didTimeout).toBeFalse()
  expect(crashed.stageTiming).toEqual({
    status: "partial",
    stages: [
      { stageName: "preprocessSolver", elapsedTimeMs: 20 },
      { stageName: "routeSolver", elapsedTimeMs: 60 },
    ],
  })
  expect(crashed.routingMetrics?.highDensityGrowthCount).toBe(4)
})
