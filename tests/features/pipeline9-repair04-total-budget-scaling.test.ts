import { expect, test } from "bun:test"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("only budgets scaled below half share one region allowance", (): void => {
  const fixture = createPipeline9Repair04Fixture()
  for (const [count, total, threshold, expected, regionAllowance] of [
    [0, 32768, 16, 32768],
    [1, 32768, 16, 32768],
    [13, 32768, 16, 32768],
    [16, 32768, 16, 32768],
    [17, 32768, 16, 30840],
    [19, 32768, 16, 27594],
    [32, 32768, 16, 16384],
    [33, 32768, 16, 8000],
    [43, 32768, 16, 8000],
    [43, 32768, 16, 200, 200],
    [32, 32768, 16, 16384, 200],
    [13, 32768, 16, 32768, 200],
    [82, 32768, 16, 6393],
    [100, 1, 1, 1],
    [82, 17, undefined, 17],
  ] as const) {
    const solver = new Pipeline9Repair04Solver({
      ...fixture,
      maxTotalCandidateAttempts: total,
      ...(regionAllowance === undefined
        ? {}
        : { maxCandidatesPerRegion: regionAllowance }),
      ...(threshold === undefined
        ? {}
        : { fullEffortReferenceErrorCount: threshold }),
      referenceDrcEvaluator: (): any[] =>
        Array.from({ length: count }, (): any => ({
          type: "reference_constraint",
          center: { x: 0, y: 0 },
        })),
    })
    solver.step()
    expect(solver.stats.initialReferenceErrors).toBe(count)
    expect(solver.stats.effectiveMaxTotalCandidateAttempts).toBe(expected)
    if (count === 0) {
      expect(solver.solved).toBe(true)
      expect(solver.stats.completionReason).toBe("clean")
      expect(solver.stats.candidateAttempts).toBe(0)
    } else {
      const child = (
        solver as unknown as {
          localSolver: {
            getConstructorParams(): [{ maxCandidateAttempts: number }]
          }
        }
      ).localSolver
      expect(child.getConstructorParams()[0].maxCandidateAttempts).toBe(
        expected,
      )
    }
  }
})
