import { expect, test } from "bun:test"
import { KrtAutoroutingPipelineSolver } from "lib/testing/KrtAutoroutingPipelineSolver"
import { krtTestBoard } from "./krtTestBoard"

test("direct KRT rejects via-in-pad permission without a plated-hole drill model", (): void => {
  const original = krtTestBoard()
  original.allowViaInPad = true
  const solver = new KrtAutoroutingPipelineSolver(original)
  expect(() => solver.solve()).toThrow("via-in-pad")
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
})
