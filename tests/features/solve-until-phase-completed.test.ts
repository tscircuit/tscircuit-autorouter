import { beforeAll, expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { blockedBoard } from "../fixtures/phase-wait/blockedBoard"
import {
  getPhaseWaitState,
  observePhaseWait,
  type PhaseWaitObservation,
  type PhaseWaitState,
} from "../fixtures/phase-wait/observePhaseWait"

let waits: PhaseWaitObservation[]
let terminalState: PhaseWaitState

beforeAll((): void => {
  const input = { ...structuredClone(blockedBoard), connections: [], obstacles: [] }
  const baseline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    effort: 0.1,
    cacheProvider: null,
  })
  baseline.solve()
  terminalState = getPhaseWaitState(baseline)
  expect(terminalState).toMatchObject({ solved: true, failed: false, error: null })
  // The completion phase remains a valid match and requires no step.
  const success = observePhaseWait(baseline, baseline.getCurrentPhase())
  expect(success).toMatchObject({ error: null, stepCalls: 0, terminalStepCalls: 0 })

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    effort: 0.1,
    cacheProvider: null,
  })
  waits = [
    observePhaseWait(solver, "notARealPhase"),
    observePhaseWait(solver, "notARealPhase"),
  ]
  for (const wait of waits) expect(wait.after).toEqual(terminalState)
})

test.failing("completion during a phase wait and repeated waits report the unreached phase", (): void => {
  const error = new Error('Routing finished before phase "notARealPhase" was reached')
  expect(
    waits.map((wait) => ({
      error: wait.error,
      stepCalls: wait.stepCalls,
      terminalStepCalls: wait.terminalStepCalls,
    })),
  ).toEqual([
    { error, stepCalls: terminalState.iterations, terminalStepCalls: 0 },
    { error, stepCalls: 0, terminalStepCalls: 0 },
  ])
})
