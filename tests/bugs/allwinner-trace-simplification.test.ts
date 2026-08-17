import { expect, test } from "bun:test"

test.skip("allwinner stitched routes complete trace simplification", async () => {
  const { createAllwinnerTraceSimplificationSolver } = await import(
    "../../fixtures/repro/allwinner-trace-simplification/create-allwinner-trace-simplification-solver"
  )
  const solver = createAllwinnerTraceSimplificationSolver()

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
})
