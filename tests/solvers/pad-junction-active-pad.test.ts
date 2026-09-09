import { expect, test } from "bun:test"
import { PadJunctionSimplificationSolver } from "lib/solvers/PadJunctionSimplificationSolver/PadJunctionSimplificationSolver"
import { createPadJunctionFixture } from "../fixtures/pad-junction"

test("visualization follows the processed pad and clears its highlight on completion", () => {
  const input = createPadJunctionFixture()
  for (const x of [10, 20])
    input.obstacles.push({
      ...input.obstacles[0]!,
      center: { x, y: 0 },
      connectedTo: [],
    })
  const solver = new PadJunctionSimplificationSolver(input)
  for (const padIndex of [0, 1]) {
    solver.step()
    const highlight = solver
      .visualize()
      .lines?.find((line) => line.label === "Current pad")
    expect(highlight).toBeDefined()
    if (!highlight) throw new Error("Expected current-pad highlight")
    const xs = highlight.points.map((point) => point.x)
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBe(
      input.obstacles[padIndex]!.center.x,
    )
  }
  solver.step()
  expect(solver.solved).toBe(true)
  expect(
    solver.visualize().lines?.some((line) => line.label === "Current pad"),
  ).toBe(false)
})
