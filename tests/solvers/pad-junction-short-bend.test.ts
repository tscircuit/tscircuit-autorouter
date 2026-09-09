import { expect, test } from "bun:test"
import {
  createPadJunctionFixture,
  expectSharedPerpendicularStem,
  solvePadJunction,
} from "../fixtures/pad-junction"

test("srj18 short terminal run remains unchanged when the head gap cannot fit", () => {
  const input = createPadJunctionFixture()
  const terminal = { x: 15.405, y: 3.005, z: 0 }
  input.hdRoutes[0]!.route = [
    { x: 14.745, y: 5.08, z: 0 },
    { x: 14.745, y: 3.665, z: 0 },
    terminal,
  ]
  input.hdRoutes[1]!.route = [
    { x: 13.805, y: 0.805, z: 0 },
    { x: 13.805, y: 1.405, z: 0 },
    terminal,
  ]
  for (const route of input.hdRoutes) route.traceThickness = 0.1
  Object.assign(input.obstacles[0]!, {
    center: terminal,
    width: 1.2,
    height: 1.4,
  })
  const solver = solvePadJunction(input)
  expect(solver.getOutput()).toEqual(input.hdRoutes)
  expect(solver.outcomes[0]?.reason).toBe(
    "Insufficient straight-run room for the head gap",
  )
  // A longer run admits the gap without moving either preceding bend.
  input.hdRoutes[0]!.route[0]!.x -= 0.1
  input.hdRoutes[0]!.route[1]!.x -= 0.1
  const longer = solvePadJunction(input)
  expectSharedPerpendicularStem(longer)
  for (const [index, route] of longer.getOutput().entries())
    expect(route.route.slice(0, 2)).toEqual(
      input.hdRoutes[index]!.route.slice(0, 2),
    )
})
