import { beforeAll, expect, spyOn, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { blockedBoard } from "../fixtures/phase-wait/blockedBoard"

beforeAll((): void => {
  const control = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(blockedBoard),
    { effort: 0.1, cacheProvider: null },
  )
  control.MAX_ITERATIONS = 2
  control.solveUntilPhase("componentDetectionSolver")
  expect(control.getCurrentPhase()).toBe("componentDetectionSolver")
  expect(control.iterations).toBe(2)
  expect(control.failed).toBe(false)
})

test.failing("phase entry cannot hide an iteration failure, including repeated waits", (): void => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(blockedBoard),
    { effort: 0.1, cacheProvider: null },
  )
  solver.MAX_ITERATIONS = 1
  const step = spyOn(solver, "step")
  try {
    expect(() => solver.solveUntilPhase("componentDetectionSolver")).toThrow(
      "ran out of iterations",
    )
    expect(solver.failed).toBe(true)
    expect(solver.getCurrentPhase()).toBe("componentDetectionSolver")
    expect(solver.iterations).toBe(2)
    expect(step).toHaveBeenCalledTimes(2)
    expect(() => solver.solveUntilPhase("componentDetectionSolver")).toThrow(
      solver.error!,
    )
    expect(step).toHaveBeenCalledTimes(2)
  } finally {
    step.mockRestore()
  }
})
