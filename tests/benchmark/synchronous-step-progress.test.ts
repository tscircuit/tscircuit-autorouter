import { expect, test } from "bun:test"
import { createSynchronousProgressStep } from "../../scripts/benchmark/synchronous-step-progress"
import type { WorkerProgress } from "../../scripts/benchmark/benchmark-types"

test("synchronous step progress survives timer starvation without changing step semantics", async () => {
  let clock = 100
  let timerCalls = 0
  const progress: WorkerProgress[] = []
  const calls: { receiver: unknown; args: unknown[] }[] = []
  const argument = { request: "unchanged" }
  const returned = { result: "unchanged" }
  const originalError = new Error("original step error")
  const router = {
    currentPipelineStepIndex: 0,
    pipelineDef: [{ solverName: "preprocess" }, { solverName: "mesh" }, { solverName: "native" }],
    activeSubSolver: { iterations: 0 },
    iterations: 0,
    solved: false,
    failed: false,
    MAX_ITERATIONS: 2_000_000,
    step(..._args: unknown[]): unknown { throw new Error("test replaces the original step") },
    async solveAsync(): Promise<void> {
      for (let index = 0; index < 4; index++) expect(this.step(argument)).toBe(returned)
    },
  }
  const originalStep = function (this: typeof router, ...args: unknown[]): unknown {
    calls.push({ receiver: this, args })
    this.iterations++
    this.activeSubSolver.iterations++
    clock += this.iterations === 3 ? 16_000 : 1
    if (this.iterations === 2) this.currentPipelineStepIndex = 1
    if (this.iterations === 4) this.currentPipelineStepIndex = 2
    if (this.iterations === 6) throw originalError
    return returned
  }
  router.step = createSynchronousProgressStep(
    originalStep,
    { solverName: "P9", scenarioName: "sample024", sampleNumber: 24, startTimeMs: 50 },
    (item) => progress.push(item),
    () => clock,
  )
  const timer = setInterval(() => { timerCalls++ }, 0)
  try {
    await router.solveAsync()
    expect(timerCalls).toBe(0)
    expect(progress.map((item) => item.phaseName)).toEqual(["preprocess", "preprocess", "mesh", "mesh", "native"])
    expect(progress.map((item) => item.synchronousStepBoundary)).toEqual(["ENTRY", "RETURN", "RETURN", "RETURN", "RETURN"])
    clock += 15_000
    expect(router.step(argument)).toBe(returned)
    expect(progress.slice(-2).map((item) => item.synchronousStepBoundary)).toEqual(["ENTRY", "RETURN"])
    expect(() => router.step(argument)).toThrow(originalError)
  } finally {
    clearInterval(timer)
  }
  expect(calls).toHaveLength(6)
  for (const call of calls) {
    expect(call.receiver).toBe(router)
    expect(call.args).toHaveLength(1)
    expect(call.args[0]).toBe(argument)
  }
  for (const item of progress) {
    expect(Object.values(item).every((value) => value === undefined || ["string", "number", "boolean"].includes(typeof value))).toBe(true)
  }
  expect(router.solved).toBe(false)
  expect(router.failed).toBe(false)
  expect(router.MAX_ITERATIONS).toBe(2_000_000)
})
