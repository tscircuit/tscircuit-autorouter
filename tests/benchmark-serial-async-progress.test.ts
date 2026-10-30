import { expect, test } from "bun:test"
import { solveWithProgress } from "../scripts/benchmark/benchmark-run-task"
import type { BenchmarkTask, WorkerProgress } from "../scripts/benchmark/benchmark-types"

test("serial solvers with solveAsync report progress through their step method", async (): Promise<void> => {
  const solver = {
    solved: false,
    failed: false,
    iterations: 0,
    currentPipelineStepIndex: 0,
    pipelineDef: [{ solverName: "preprocess" }, { solverName: "routing" }],
    startTimeOfPhase: {},
    timeSpentOnPhase: { preprocess: 1 },
    async solveAsync(): Promise<void> {
      throw new Error("Serial progress must not use a blocking solveAsync")
    },
    step(): void {
      this.iterations++
      if (this.iterations === 2) this.currentPipelineStepIndex = 1
      if (this.iterations === 4) this.solved = true
    },
  }
  const task: BenchmarkTask = {
    datasetName: "test",
    solverName: "test",
    scenarioName: "serial-progress",
    sampleNumber: 1,
    threads: 1,
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
    onProgress: (progress): void => { reports.push(progress) },
  })
  expect(solver.solved).toBe(true)
  expect(reports.map((report) => report.phaseName)).toEqual([
    "preprocess", "routing", "routing",
  ])
  expect(reports[1]!.solverIterations).toBe(2)
})
