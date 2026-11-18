import { spyOn } from "bun:test"
import type { BaseSolver } from "lib/solvers/BaseSolver"

type PhasedSolver = BaseSolver & {
  getCurrentPhase(): string
  solveUntilPhase(phase: string): void
}

export type PhaseWaitState = {
  failed: boolean
  solved: boolean
  phase: string
  iterations: number
  error: string | null
}

export type PhaseWaitObservation = {
  error: unknown
  stepCalls: number
  terminalStepCalls: number
  before: PhaseWaitState
  after: PhaseWaitState
}

export function getPhaseWaitState(solver: PhasedSolver): PhaseWaitState {
  return {
    failed: solver.failed,
    solved: solver.solved,
    phase: solver.getCurrentPhase(),
    iterations: solver.iterations,
    error: solver.error,
  }
}

export function observePhaseWait(
  solver: PhasedSolver,
  phase: string,
): PhaseWaitObservation {
  const before = getPhaseWaitState(solver)
  const step = solver.step.bind(solver)
  let stepCalls = 0
  let terminalStepCalls = 0
  let error: unknown = null
  const guardedStep = spyOn(solver, "step").mockImplementation((): void => {
    stepCalls++
    // Bound an otherwise infinite no-op loop without a wall-clock timeout.
    if (solver.failed || solver.solved) {
      terminalStepCalls++
      throw new Error("Test guard: phase wait stepped a terminal solver")
    }
    step()
  })
  try {
    solver.solveUntilPhase(phase)
  } catch (caught) {
    error = caught
  } finally {
    guardedStep.mockRestore()
  }
  return {
    error,
    stepCalls,
    terminalStepCalls,
    before,
    after: getPhaseWaitState(solver),
  }
}
