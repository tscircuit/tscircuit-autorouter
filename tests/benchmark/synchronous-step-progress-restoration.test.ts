import { expect, test } from "bun:test"
import { solveWithProgress } from "../../scripts/benchmark/benchmark-run-task"
import type { WorkerProgress } from "../../scripts/benchmark/benchmark-types"

test("benchmark opt-in observes synchronous routing and restores inherited and own steps", async () => {
  const previous = process.env.SAMPLE24_SYNCHRONOUS_STEP_PROGRESS
  process.env.SAMPLE24_SYNCHRONOUS_STEP_PROGRESS = "1"
  const records: WorkerProgress[] = []
  const task = { solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph", scenarioName: "sample024", sampleNumber: 24, threads: 1 }
  const argument = { unchanged: true }
  const result = { unchanged: true }
  class Router {
    pipelineDef = [{ solverName: "preprocess" }, { solverName: "mesh" }]
    currentPipelineStepIndex = 0
    timeSpentOnPhase = { preprocess: 1 }
    startTimeOfPhase = {}
    iterations = 0
    activeSubSolver = null
    solved = false
    failed = false
    MAX_ITERATIONS = 2_000_000
    calls = 0
    returned: unknown
    step(value: unknown): unknown {
      expect(this).toBe(router)
      expect(value).toBe(argument)
      this.calls++
      this.iterations++
      this.currentPipelineStepIndex = 1
      this.solved = true
      return result
    }
    async solveAsync(): Promise<void> { this.returned = this.step(argument) }
  }
  const router = new Router()
  const original = router.step
  try {
    await solveWithProgress(task as any, router as any, performance.now(), { onProgress: (item) => records.push(item) })
    expect(router.calls).toBe(1)
    expect(router.returned).toBe(result)
    expect(router.step).toBe(original)
    expect(Object.hasOwn(router, "step")).toBe(false)
    expect(router.solved).toBe(true)
    expect(router.failed).toBe(false)
    expect(router.MAX_ITERATIONS).toBe(2_000_000)
    expect(records.filter((item) => item.synchronousStepBoundary).map((item) => [item.synchronousStepBoundary, item.phaseName])).toEqual([["ENTRY", "preprocess"], ["RETURN", "mesh"]])
    const failure = new Error("original failure")
    const ownRouter = new Router()
    const ownStep = function (this: typeof ownRouter): never {
      expect(this).toBe(ownRouter)
      this.calls++
      throw failure
    }
    Object.defineProperty(ownRouter, "step", { value: ownStep, writable: true, configurable: true, enumerable: false })
    const descriptor = Object.getOwnPropertyDescriptor(ownRouter, "step")
    let caught: unknown
    try {
      await solveWithProgress(task as any, ownRouter as any, performance.now(), { onProgress: (item) => records.push(item) })
    } catch (error) { caught = error }
    expect(caught).toBe(failure)
    expect(ownRouter.calls).toBe(1)
    expect(ownRouter.solved).toBe(false)
    expect(ownRouter.failed).toBe(false)
    expect(Object.getOwnPropertyDescriptor(ownRouter, "step")).toEqual(descriptor)
  } finally {
    if (previous === undefined) delete process.env.SAMPLE24_SYNCHRONOUS_STEP_PROGRESS
    else process.env.SAMPLE24_SYNCHRONOUS_STEP_PROGRESS = previous
  }
})
