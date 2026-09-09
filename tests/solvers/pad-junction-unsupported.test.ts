import { expect, test } from "bun:test"
import {
  createPadJunctionFixture,
  solvePadJunction,
} from "../fixtures/pad-junction"

test("unsupported topology, pad shapes, layers, and widths retain original copper", () => {
  for (const scenario of [
    "collinear",
    "obtuse",
    "three",
    "layer",
    "width",
    "rotated",
    "jumper",
    "through-obstacle",
  ]) {
    const input = createPadJunctionFixture()
    const second = input.hdRoutes[1]!
    if (scenario === "collinear") second.route[0] = { x: -1, y: 2, z: 0 }
    if (scenario === "obtuse") second.route[0] = { x: 2, y: -4, z: 0 }
    if (scenario === "three")
      input.hdRoutes.push({
        ...second,
        connectionName: "third",
        route: [
          { x: 0, y: 4, z: 0 },
          { x: 0, y: 0, z: 0 },
        ],
      })
    if (scenario === "layer") for (const point of second.route) point.z = 1
    if (scenario === "width") second.traceThickness = 0.3
    if (scenario === "rotated") input.obstacles[0]!.ccwRotationDegrees = 45
    if (scenario === "jumper") second.route[0]!.insideJumperPad = true
    if (scenario === "through-obstacle")
      second.route[0]!.toNextSegmentType = "through_obstacle"
    const original = structuredClone(input.hdRoutes)
    expect(solvePadJunction(input).getOutput()).toEqual(original)
  }
})
