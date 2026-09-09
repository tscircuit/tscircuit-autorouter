import { expect, test } from "bun:test"
import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import {
  createPadJunctionFixture,
  expectSharedPerpendicularStem,
  solvePadJunction,
} from "../fixtures/pad-junction"

test("the head leaves a visible half-trace-width gap in every orientation", () => {
  for (const width of [0.1, 0.2, 0.4]) {
    for (const rotation of [0, 1, 2, 3]) {
      const input = createPadJunctionFixture()
      for (const route of input.hdRoutes) {
        route.traceThickness = width
        for (const point of route.route) {
          for (let turn = 0; turn < rotation; turn++)
            [point.x, point.y] = [-point.y, point.x]
        }
      }
      const solver = solvePadJunction(input)
      expectSharedPerpendicularStem(solver)
      const replacement = solver.acceptedReplacement
      if (!replacement) throw new Error("Expected a V replacement")
      const edgeGap =
        segmentToBoxMinDistance(
          replacement.head[0],
          replacement.head[1],
          input.obstacles[0]!,
        ) -
        width / 2
      expect(edgeGap).toBeGreaterThanOrEqual(width / 2 - 1e-7)
    }
  }
})
