import { expect, test } from "bun:test"
import { solveWithProgress } from "../scripts/benchmark/benchmark-run-task"
import type { WorkerProgress } from "../scripts/benchmark/benchmark-types"

test("high-density memory and time are captured once before later pipeline work", async (): Promise<void> => {
  const solver = {
    solved: false,
    failed: false,
    iterations: 0,
    currentPipelineStepIndex: 0,
    pipelineDef: [
      { solverName: "highDensityRouteSolver" },
      { solverName: "highDensityForceImproveSolver" },
      { solverName: "later" },
    ],
    timeSpentOnPhase: {
      highDensityRouteSolver: 1,
      highDensityForceImproveSolver: 1,
    },
    startTimeOfPhase: {},
    highDensityRouteSolver: { solved: false },
    step(): void {
      this.iterations++
      if (this.iterations === 1) {
        this.highDensityRouteSolver.solved = true
        this.currentPipelineStepIndex = 1
      } else if (this.iterations === 2) {
        this.currentPipelineStepIndex = 2
      } else this.solved = true
    },
  }
  const reports: WorkerProgress[] = []
  await solveWithProgress(
    {
      datasetName: "test",
      solverName: "test",
      scenarioName: "stages",
      sampleNumber: 1,
      scenario: {
        layerCount: 2,
        minTraceWidth: 0.1,
        obstacles: [],
        connections: [],
        bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
      },
    },
    solver,
    performance.now(),
    {
      progressIntervalMs: Infinity,
      onProgress: (progress): void => {
        reports.push(progress)
      },
    },
  )
  expect(reports[0].highDensityStage).toBeUndefined()
  const milestone = reports[1].highDensityStage!
  expect(milestone.peakRssBytes).toBeGreaterThan(0)
  expect(milestone.elapsedTimeMs).toBeGreaterThanOrEqual(0)
  expect(reports[2].highDensityStage).toBe(milestone)
  expect(reports[3].highDensityStage).toBe(milestone)
  expect(reports[1].phaseName).toBe("highDensityForceImproveSolver")
})
