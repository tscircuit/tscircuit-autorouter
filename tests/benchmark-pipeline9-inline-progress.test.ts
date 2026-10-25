import { expect, spyOn, test } from "bun:test"
import { solveWithProgress } from "../scripts/benchmark/benchmark-run-task"
import type {
  BenchmarkTask,
  WorkerProgress,
} from "../scripts/benchmark/benchmark-types"

test("single-threaded local Pipeline9 reports inline progress without polling every step", async (): Promise<void> => {
  const task: BenchmarkTask = {
    datasetName: "test",
    solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph",
    scenarioName: "inline-progress",
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
  const solver = {
    solved: false,
    failed: false,
    iterations: 0,
    asyncCalls: 0,
    error: null as string | null,
    timeToSolve: undefined as number | undefined,
    currentPipelineStepIndex: 0,
    pipelineDef: [
      { solverName: "first" },
      { solverName: "middle" },
      { solverName: "last" },
    ],
    startTimeOfPhase: { first: 0, middle: 1000, last: 2000 },
    timeSpentOnPhase: { first: 1000, middle: 1000 },
    step(): void {
      this.iterations++
      if (this.iterations === 1000) this.currentPipelineStepIndex = 1
      if (this.iterations === 2000) this.currentPipelineStepIndex = 2
      if (this.iterations === 5000) this.solved = true
    },
    async solveAsync(): Promise<void> {
      this.asyncCalls++
      const start = performance.now()
      try {
        // This is Pipeline9's no-runtime behavior: no event-loop yield.
        while (!this.solved && !this.failed) this.step()
      } catch (error) {
        this.failed = true
        this.error = `Pipeline9 asynchronous solve error: ${error}`
        throw error
      } finally {
        this.timeToSolve = performance.now() - start
      }
    },
  }
  const originalStep = solver.step
  const originalDescriptor = Object.getOwnPropertyDescriptor(solver, "step")
  const reports: WorkerProgress[] = []
  const clock = spyOn(performance, "now").mockImplementation(
    (): number => solver.iterations,
  )
  try {
    await solveWithProgress(task, solver, 0, {
      progressIntervalMs: 1000,
      onProgress: (progress): void => {
        reports.push(progress)
      },
    })
    expect(reports.map((report) => report.phaseName)).toEqual([
      "first",
      "middle",
      "last",
      "last",
      "last",
      "last",
    ])
    expect(reports.map((report) => report.solverIterations)).toEqual([
      0, 1000, 2000, 3024, 4048, 5000,
    ])
    expect(clock.mock.calls.length).toBeLessThan(20)
    expect(solver.asyncCalls).toBe(1)
    expect(solver.step).toBe(originalStep)
    expect(Object.getOwnPropertyDescriptor(solver, "step")).toEqual(
      originalDescriptor,
    )
    expect(solver.timeToSolve).toBe(5000)
  } finally {
    clock.mockRestore()
  }

  const inherited = Object.assign(Object.create(solver) as typeof solver, {
    solved: false,
    failed: false,
    iterations: 0,
    currentPipelineStepIndex: 0,
    asyncCalls: 0,
  })
  await solveWithProgress(task, inherited, performance.now(), {
    onProgress: (): void => {},
  })
  expect(Object.hasOwn(inherited, "step")).toBe(false)
  expect(inherited.step).toBe(originalStep)
  expect(inherited.asyncCalls).toBe(1)

  const asynchronous = {
    ...solver,
    solved: false,
    failed: false,
    asyncCalls: 0,
    step(): void {
      throw new Error("asynchronous solver must not be stepped inline")
    },
    async solveAsync(): Promise<void> {
      this.asyncCalls++
      await Promise.resolve()
      this.solved = true
    },
  }
  await solveWithProgress(
    { ...task, solverName: "AutoroutingPipelineSolver9_Networked" },
    asynchronous,
    performance.now(),
    { onProgress: (): void => {} },
  )
  expect(asynchronous.asyncCalls).toBe(1)
  expect(asynchronous.solved).toBe(true)

  const silent = { ...asynchronous, solved: false, asyncCalls: 0 }
  await solveWithProgress(task, silent, performance.now(), {})
  expect(silent.asyncCalls).toBe(1)
  expect(silent.solved).toBe(true)

  const failing = {
    ...solver,
    solved: false,
    failed: false,
    timeToSolve: undefined as number | undefined,
    step(): never {
      throw new Error("expected routing failure")
    },
    error: null as string | null,
  }
  const failingStep = failing.step
  await expect(
    solveWithProgress(task, failing, performance.now(), {
      onProgress: (): void => {},
    }),
  ).rejects.toThrow("expected routing failure")
  expect(failing.failed).toBe(true)
  expect(failing.error).toBe(
    "Pipeline9 asynchronous solve error: Error: expected routing failure",
  )
  expect(failing.timeToSolve).toBeNumber()
  expect(failing.step).toBe(failingStep)
})
