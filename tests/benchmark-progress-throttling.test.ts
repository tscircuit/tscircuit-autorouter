import { expect, test } from "bun:test"
import { solveWithProgress } from "../scripts/benchmark/benchmark-run-task"
import type {
  BenchmarkTask,
  WorkerProgress,
} from "../scripts/benchmark/benchmark-types"

test("throttled benchmark progress avoids building reports but preserves phase changes", async (): Promise<void> => {
  let completedTimingReads = 0
  const solver = {
    solved: false,
    failed: false,
    iterations: 0,
    currentPipelineStepIndex: 0,
    pipelineDef: [{ solverName: "first" }, { solverName: "second" }],
    startTimeOfPhase: { first: 0, second: 0 },
    timeSpentOnPhase: {
      get first(): number {
        completedTimingReads++
        return 1
      },
    },
    step(): void {
      this.iterations++
      if (this.iterations === 100) this.currentPipelineStepIndex = 1
      if (this.iterations === 200) this.solved = true
    },
  }
  const task: BenchmarkTask = {
    datasetName: "test",
    solverName: "test",
    scenarioName: "test",
    sampleNumber: 1,
    scenario: {
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      connections: [],
      obstacles: [],
      layerCount: 2,
      minTraceWidth: 0.1,
    },
  }
  const reports: WorkerProgress[] = []
  await solveWithProgress(task, solver, performance.now(), {
    progressIntervalMs: Infinity,
    onProgress: (progress): void => {
      reports.push(progress)
    },
  })
  expect(solver.solved).toBe(true)
  expect(reports.map((report) => report.phaseName)).toEqual([
    "first",
    "second",
    "second",
  ])
  expect(reports.map((report) => report.solverIterations)).toEqual([
    0, 100, 200,
  ])
  expect(reports[1]!.stageTiming?.stages[0]).toEqual({
    stageName: "first",
    elapsedTimeMs: 1,
  })
  expect(completedTimingReads).toBe(2)
})
