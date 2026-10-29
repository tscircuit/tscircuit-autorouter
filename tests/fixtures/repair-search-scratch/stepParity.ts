import { expect } from "bun:test"

type Solver = {
  solved: boolean
  failed: boolean
  iterations: number
  MAX_ITERATIONS: number
  progress: number
  error: unknown
  stats: unknown
  activeSubSolver?: unknown
  step: () => void
  getOutput?: () => unknown
}

export function solverSnapshot(solver: Solver): unknown {
  const internals = solver as unknown as Record<string, unknown>
  return {
    solved: solver.solved, failed: solver.failed, iterations: solver.iterations,
    MAX_ITERATIONS: solver.MAX_ITERATIONS, progress: solver.progress,
    error: solver.error, stats: structuredClone(solver.stats), phase: internals.phase,
    cursor: internals.cursor, barrierCount: internals.barrierCount,
    laneErrors: internals.laneErrors,
    active: solver.activeSubSolver ? solverSnapshot(solver.activeSubSolver as Solver) : undefined,
  }
}

export function runStepParity(reference: Solver, candidate: Solver): number {
  let steps = 0
  expect(solverSnapshot(candidate)).toEqual(solverSnapshot(reference))
  while (!reference.solved && !reference.failed) {
    let referenceError: unknown, candidateError: unknown
    try { reference.step() } catch (error) { referenceError = error }
    try { candidate.step() } catch (error) { candidateError = error }
    expect(candidateError).toEqual(referenceError)
    expect(solverSnapshot(candidate)).toEqual(solverSnapshot(reference))
    if (referenceError) return steps
    steps++
    expect(steps).toBeLessThan(100000)
  }
  expect(candidate.solved).toBe(reference.solved)
  expect(candidate.failed).toBe(reference.failed)
  if (reference.solved && !reference.failed && reference.getOutput && candidate.getOutput) {
    expect(candidate.getOutput()).toEqual(reference.getOutput())
  }
  return steps
}
