import { expect, test } from "bun:test"
import {
  createPadJunctionFixture,
  solvePadJunction,
} from "../fixtures/pad-junction"

test("a blocked T is visible as a proposal but never as applied copper", () => {
  const input = createPadJunctionFixture()
  input.obstacles.push({
    ...input.obstacles[0]!,
    obstacleId: "foreign-pad",
    center: { x: 0, y: 1.2 },
    width: 0.2,
    height: 0.1,
    connectedTo: ["foreign-net"],
  })
  const solver = solvePadJunction(input)
  expect(solver.outcomes[0]?.outcome).toBe("no_path")
  expect(
    solver.constructPadTsSolver
      .visualize()
      .lines?.some((line) => line.label === "Head"),
  ).toBe(true)
  const applied = solver.applyPadTsSolver.visualize()
  expect(applied.lines?.some((line) => line.label === "Head")).toBe(false)
  expect(applied.lines?.some((line) => line.label === "Current pad")).toBe(true)
  expect(applied.title).toBe("Head or stem violates pad clearance")
  expect(solver.getOutput()).toEqual(input.hdRoutes)
})
