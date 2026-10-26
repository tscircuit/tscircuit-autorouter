import { expect, test } from "bun:test"
import { createRaceHarness } from "../fixtures/hdFamilyRace"

test("outer-budget final acceptance validates only an already-complete incumbent and performs no extra search", (): void => {
  for (const allowed of [false, true]) {
    let validations = 0
    const { solver, portfolios } = createRaceHarness({
      plans: {
        1: { completeAfter: Infinity, budget: 2 },
        2: { completeAfter: 3, budget: 5 },
        4: { completeAfter: 1, budget: 5 },
      },
      makeOtherBest: true,
      validator: (): boolean => {
        validations++
        return allowed
      },
    })
    solver.MAX_ITERATIONS = 3
    for (let i = 0; i < 4; i++) solver.step()
    expect(solver.solved).toBe(allowed)
    expect(solver.failed).toBe(!allowed)
    expect(validations).toBe(1)
    expect(portfolios.get(4)!.native.iterations).toBe(1)
    expect(portfolios.get(2)!.native.iterations).toBe(1)
    expect(solver["scaleSearch"]).toBeUndefined()
    if (allowed) expect(solver.winningSolver).toBe(portfolios.get(4))
    else expect(solver.error).toContain("ran out of iterations")
  }
})
