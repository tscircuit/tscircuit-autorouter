import { expect, test } from "bun:test"
import {
  createPadJunctionFixture,
  expectSharedPerpendicularStem,
  solvePadJunction,
} from "../fixtures/pad-junction"

test("direct V construction handles rotations, reflections, and unequal branch lengths", () => {
  for (const swapAxes of [false, true]) {
    for (const sign of [-1, 1]) {
      for (const rightX of [1.5, 2, 4]) {
        const input = createPadJunctionFixture()
        input.hdRoutes[1]!.route[0]!.x = rightX
        for (const route of input.hdRoutes) {
          for (const point of route.route) {
            const { x, y } = point
            point.x = swapAxes ? sign * y : x
            point.y = swapAxes ? x : sign * y
          }
        }
        const solver = solvePadJunction(input)
        expectSharedPerpendicularStem(solver)
        expect(
          solvePadJunction({
            ...input,
            hdRoutes: solver.getOutput(),
          }).getOutput(),
        ).toEqual(solver.getOutput())
      }
    }
  }
  // Original voltage-divider reproduction and srj18 problem01's short-arm pad.
  for (const geometry of [
    {
      terminal: { x: 3.0875, y: -2 },
      anchors: [
        { x: 2, y: -0.912 },
        { x: 4.179029, y: -0.908471 },
      ],
      width: 1.025,
      height: 1.4,
      z: 0,
    },
    {
      terminal: { x: 21.59, y: 24.13 },
      anchors: [
        { x: 20.5295468, y: 25.1904532 },
        { x: 19.04, y: 21.58 },
      ],
      width: 1.7,
      height: 1.7,
      z: 1,
    },
  ]) {
    const input = createPadJunctionFixture()
    for (const [index, route] of input.hdRoutes.entries()) {
      route.route = [
        { ...geometry.anchors[index]!, z: geometry.z },
        { ...geometry.terminal, z: geometry.z },
      ]
    }
    Object.assign(input.obstacles[0]!, {
      center: geometry.terminal,
      width: geometry.width,
      height: geometry.height,
      layers: [geometry.z === 0 ? "top" : "bottom"],
    })
    expectSharedPerpendicularStem(solvePadJunction(input))
  }
})
