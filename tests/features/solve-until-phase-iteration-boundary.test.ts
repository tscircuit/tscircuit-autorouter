import { beforeAll, expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { blockedBoard } from "../fixtures/phase-wait/blockedBoard"
import {
  observePhaseWait,
  type PhaseWaitObservation,
} from "../fixtures/phase-wait/observePhaseWait"

let waits: PhaseWaitObservation[]
let failure: string

beforeAll((): void => {
  const control = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(blockedBoard),
    { effort: 0.1, cacheProvider: null },
  )
  control.MAX_ITERATIONS = 2
  const success = observePhaseWait(control, "componentDetectionSolver")
  expect(success.error).toBeNull()
  expect(success.stepCalls).toBe(2)
  expect(success.after).toMatchObject({
    phase: "componentDetectionSolver",
    iterations: 2,
    failed: false,
  })

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(blockedBoard),
    { effort: 0.1, cacheProvider: null },
  )
  solver.MAX_ITERATIONS = 1
  waits = [
    observePhaseWait(solver, "componentDetectionSolver"),
    observePhaseWait(solver, "componentDetectionSolver"),
  ]
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("ran out of iterations")
  failure = solver.error!
  for (const wait of waits) {
    expect(wait.after).toMatchObject({
      failed: true,
      solved: false,
      phase: "componentDetectionSolver",
      iterations: 2,
      error: failure,
    })
  }
})

test(
  "phase entry cannot hide an iteration failure, including repeated waits",
  (): void => {
    expect(
      waits.map((wait) => ({
        error: wait.error,
        stepCalls: wait.stepCalls,
        terminalStepCalls: wait.terminalStepCalls,
      })),
    ).toEqual([
      { error: new Error(failure), stepCalls: 2, terminalStepCalls: 0 },
      { error: new Error(failure), stepCalls: 0, terminalStepCalls: 0 },
    ])
  },
)
