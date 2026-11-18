import { beforeAll, expect, spyOn, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { blockedBoard } from "../fixtures/phase-wait/blockedBoard"

const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
  { ...structuredClone(blockedBoard), connections: [], obstacles: [] },
  { effort: 0.1, cacheProvider: null },
)

beforeAll((): void => {
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  // The completion phase is still a valid phase match and requires no step.
  const step = spyOn(solver, "step")
  try {
    solver.solveUntilPhase(solver.getCurrentPhase())
    expect(step).not.toHaveBeenCalled()
  } finally {
    step.mockRestore()
  }
})

test.failing("a completed solver reports an unreached phase without stepping", (): void => {
  const step = spyOn(solver, "step").mockImplementation((): void => {
    throw new Error("phase wait attempted to step a completed solver")
  })
  try {
    expect(() => solver.solveUntilPhase("notARealPhase")).toThrow(
      'Routing finished before phase "notARealPhase" was reached',
    )
    expect(step).not.toHaveBeenCalled()
  } finally {
    step.mockRestore()
  }
})
