import type { Repair04Solver } from "@tscircuit/repair04"
import { expect, test } from "bun:test"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createTotalBudgetFixture } from "../fixtures/pipeline9-repair04-total-budget-fixture"

test("indexed-only repairs after reference progress consume the graduated allowance", (): void => {
  const fixture = createTotalBudgetFixture()
  const solver = new Pipeline9Repair04Solver({
    ...fixture,
    maxRegions: 10,
    maxInitialCandidateAttempts: 1,
    maxCandidateAttemptsSinceAcceptance: 2,
    referenceDrcEvaluator: (input): ReturnType<typeof fixture.referenceDrcEvaluator> => {
      const result = fixture.referenceDrcEvaluator(input)
      const errors = Array.isArray(result) ? result : result.errors
      if (errors.length >= 2) return errors
      return [
        ...errors,
        ...Array.from({ length: 2 - errors.length }, (_, index): { type: string; center: { x: number; y: number } } => ({
          type: `remaining_constraint_${index}`,
          center: { x: 0, y: -12 },
        })),
      ]
    },
  })
  const children: Repair04Solver[] = []
  while (!solver.solved && !solver.failed) {
    solver.step()
    const child = (solver as unknown as { localSolver: Repair04Solver | null }).localSolver
    if (child && children.at(-1) !== child) children.push(child)
  }
  expect(solver.failed).toBe(false)
  expect(children.map((child): number | undefined => child.getConstructorParams()[0].maxCandidateAttempts)).toEqual([1, 2, 1])
  expect(solver.stats.acceptedRegions).toBe(3)
  expect(solver.stats.referenceErrors).toBe(2)
  expect(solver.stats.indexedErrors).toBe(0)
  expect(solver.stats.candidateAttempts).toBe(3)
  expect(solver.stats.attemptsSinceAcceptance).toBe(2)
  expect(solver.stats.nodesSinceAcceptance).toBe(
    children[1]!.stats.pathSearchNodes + children[2]!.stats.pathSearchNodes,
  )
  expect(solver.stats.completionReason).toBe("unsuccessful-work-budget")
})
