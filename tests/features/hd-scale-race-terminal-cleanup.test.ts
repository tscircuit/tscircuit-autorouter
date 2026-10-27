import { expect, spyOn, test } from "bun:test"
import { createRaceHarness } from "../fixtures/hdFamilyRace"

test("outer-budget failures and thrown child errors release private race siblings while preserving public debug state", (): void => {
  for (const cause of ["outer-budget", "child-error"] as const) {
    const { solver, portfolios } = createRaceHarness({
      plans: {
        1: {
          completeAfter: Infinity,
          budget: 5,
          throwAt: cause === "child-error" ? 1 : undefined,
        },
        2: { completeAfter: 10, budget: 20 },
        4: { completeAfter: 10, budget: 20 },
      },
    })
    if (cause === "outer-budget") solver.MAX_ITERATIONS = 0
    const logging = spyOn(console, "error").mockImplementation((): void => {})
    try {
      if (cause === "child-error") {
        expect(() => solver.step()).toThrow("scripted A03 failure")
      } else {
        solver.step()
        expect(solver.error).toContain("ran out of iterations")
      }
    } finally {
      logging.mockRestore()
    }
    expect(solver.failed).toBe(true)
    expect(solver["scaleSearch"]).toBeUndefined()
    expect(solver.activeSubSolver).toBe(portfolios.get(1)!)
    expect(portfolios.get(2)!.failed).toBe(false)
    expect(portfolios.get(4)!.failed).toBe(false)
    expect(solver.winningSolver).toBeUndefined()
  }
})
