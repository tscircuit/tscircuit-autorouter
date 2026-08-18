import { expect, test } from "bun:test"
import { BaseSolver } from "lib/solvers/BaseSolver"

class PendingEffectSolver extends BaseSolver {
  override _step(): void {
    this.pendingEffects = [
      {
        name: "never-settles",
        promise: new Promise(() => undefined),
      },
    ]
  }
}

test("BaseSolver synchronous solve fails loudly when an async effect starts", () => {
  const solver = new PendingEffectSolver()

  expect(() => solver.solve()).toThrow(
    "requires asynchronous execution while effects are pending",
  )
  expect(solver.iterations).toBe(1)
})
