import { expect, test } from "bun:test"
import { RouteStitchClearanceValidator } from "lib/solvers/RouteStitchingSolver/route-stitch-clearance-validator"

test("stitch detour vertices cannot inherit an existing endpoint violation", () => {
  const validator = new RouteStitchClearanceValidator({
    hdRoutes: [
      {
        connectionName: "foreign",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 0.4, y: -0.5, z: 0 },
          { x: 0.4, y: 0.5, z: 0 },
        ],
        vias: [],
      },
    ],
  })
  const segment = {
    connectionName: "target",
    traceThickness: 0.15,
    start: { x: 0.2, y: -0.1, z: 0 },
    end: { x: 0.2, y: 0.1, z: 0 },
  }

  expect(validator.isSegmentClear(segment)).toBe(true)
  expect(
    validator.isSegmentClear({
      ...segment,
      allowedClearanceViolationEndpoints: [
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
    }),
  ).toBe(false)
})
