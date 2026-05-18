import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import input from "../../fixtures/features/uniform-port-distribution-path-ordering-issue-repro.json"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"

test("UniformPortDistributionSolver redistributes an integer-grid L-shape like the reference sketch", () => {
  const solver = new UniformPortDistributionSolver(input as any)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(getSvgFromGraphicsObject(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
