import { expect, test } from "bun:test"
import {
  createPadJunctionFixture,
  solvePadJunction,
} from "../fixtures/pad-junction"

test("direct construction cannot cross foreign copper, vias, pads, or the board outline", () => {
  for (const scenario of ["trace", "via", "pad", "bounds", "outline"]) {
    const input = createPadJunctionFixture()
    if (scenario === "trace" || scenario === "via")
      input.otherHdRoutes = [
        {
          connectionName: "foreign",
          traceThickness: 0.2,
          viaDiameter: 0.4,
          route: [
            { x: 0, y: 0.7, z: 0 },
            { x: 0, y: 1.5, z: 0 },
          ],
          vias: scenario === "via" ? [{ x: 0, y: 1.1 }] : [],
        },
      ]
    if (scenario === "via")
      input.otherHdRoutes![0]!.route = [{ x: 8, y: 8, z: 1 }]
    if (scenario === "pad")
      input.obstacles.push({
        type: "rect",
        center: { x: 0, y: 1.1 },
        width: 0.3,
        height: 0.3,
        layers: ["top"],
        connectedTo: ["foreign"],
      })
    if (scenario === "bounds")
      input.bounds = { minX: -5, maxX: 5, minY: 1.2, maxY: 5 }
    if (scenario === "outline")
      input.outline = [
        { x: -5, y: 1.2 },
        { x: 5, y: 1.2 },
        { x: 5, y: 5 },
        { x: -5, y: 5 },
      ]
    expect(solvePadJunction(input).getOutput()).toEqual(input.hdRoutes)
  }
})
