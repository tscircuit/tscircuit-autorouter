import { expect, test } from "bun:test"
import { solveWithProgress } from "../scripts/benchmark/benchmark-run-task"
import type {
  BenchmarkTask,
  WorkerProgress,
} from "../scripts/benchmark/benchmark-types"

type StallingSolver = {
  solved: boolean
  failed: boolean
  iterations: number
  currentPipelineStepIndex: number
  pipelineDef: { solverName: string }[]
  startTimeOfPhase: Record<string, number>
  timeSpentOnPhase: Record<string, number>
  step: () => void
  solveAsync: () => Promise<void>
}

test("a single-threaded stall reports the phase that was actually running", async (): Promise<void> => {
  const solver: StallingSolver = {
    solved: false,
    failed: false,
    iterations: 0,
    currentPipelineStepIndex: 0,
    pipelineDef: [{ solverName: "first" }, { solverName: "stalling" }],
    startTimeOfPhase: { first: 0 },
    timeSpentOnPhase: { first: 1 },
    step(): void {
      this.iterations++
      if (this.iterations === 2) this.currentPipelineStepIndex = 1
      if (this.iterations === 3) {
        const blockedUntil = performance.now() + 20
        while (performance.now() < blockedUntil) {}
        throw new Error("stalling phase blocked the event loop")
      }
    },
    async solveAsync(): Promise<void> {
      while (!this.solved && !this.failed) {
        this.step()
      }
    },
  }
  const task: BenchmarkTask = {
    datasetName: "test",
    solverName: "StallingSolver",
    scenarioName: "stalling-phase",
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
  let solveError: string | undefined
  try {
    await solveWithProgress(task, solver, performance.now(), {
      progressIntervalMs: 60_000,
      onProgress: (progress): void => {
        reports.push(progress)
      },
    })
  } catch (error) {
    solveError = error instanceof Error ? error.message : String(error)
  }

  expect(solveError).toBe("stalling phase blocked the event loop")
  expect(reports.map((report) => report.phaseName)).toEqual([
    "first",
    "stalling",
  ])
})
