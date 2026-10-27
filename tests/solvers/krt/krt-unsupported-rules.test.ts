import { expect, test } from "bun:test"
import { KrtAutoroutingPipelineSolver } from "lib/testing/KrtAutoroutingPipelineSolver"
import { krtTestBoard } from "./krtTestBoard"

test("direct KRT rejects unsupported declared pad rules before claiming solved", (): void => {
  const original = krtTestBoard()
  original.minPlatedHoleDrillEdgeToDrillEdgeClearance = 0.3
  const solver = new KrtAutoroutingPipelineSolver(original)
  expect(() => solver.solve()).toThrow("typed pad/plated-hole rules")
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
})
