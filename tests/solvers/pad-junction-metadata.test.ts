import { expect, test } from "bun:test"
import {
  createPadJunctionFixture,
  solvePadJunction,
} from "../fixtures/pad-junction"

test("replacement preserves exact rounded endpoints, route direction, metadata, and input", () => {
  const input = createPadJunctionFixture()
  const firstAnchor = input.hdRoutes[0]!.route[0]!
  input.hdRoutes[0]!.route.unshift({ ...firstAnchor, z: 1 })
  input.hdRoutes[0]!.vias.push({ x: firstAnchor.x, y: firstAnchor.y })
  input.hdRoutes[1]!.route.at(-1)!.x = 0.0005
  input.hdRoutes[1]!.route.reverse()
  input.hdRoutes[1]!.startPcbPortId = "target"
  input.hdRoutes[1]!.endPcbPortId = "anchor1"
  const snapshot = structuredClone({
    routes: input.hdRoutes,
    obstacles: input.obstacles,
  })
  const solver = solvePadJunction(input)
  expect(
    solver.outcomes.some((outcome) => outcome.outcome === "accepted"),
  ).toBe(true)
  for (const [index, route] of solver.getOutput().entries()) {
    const original = input.hdRoutes[index]!
    expect(route.route[0]).toEqual(original.route[0])
    if (index === 0)
      expect(route.route.slice(0, 2)).toEqual(original.route.slice(0, 2))
    expect(route.route.at(-1)).toEqual(original.route.at(-1))
    expect({ ...route, route: [] }).toEqual({ ...original, route: [] })
  }
  expect({ routes: input.hdRoutes, obstacles: input.obstacles }).toEqual(
    snapshot,
  )
})
