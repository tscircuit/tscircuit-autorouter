import { expect, test } from "bun:test"
import { createStitchSegmentValidator } from "lib/solvers/RouteStitchingSolver/createStitchSegmentValidator"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const makeRoute = (
  connectionName: string,
  points: Array<{ x: number; y: number; z: number }>,
  vias: Array<{ x: number; y: number }> = [],
): HighDensityIntraNodeRoute => ({
  connectionName,
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: points,
  vias,
  jumpers: [],
})

const candidate = {
  connectionName: "candidate",
  start: { x: 0, y: -1, z: 0 },
  end: { x: 0, y: 1, z: 0 },
  traceThickness: 0.15,
}

test("stitch validator rejects foreign trace and via crossings", () => {
  const foreignTraceValidator = createStitchSegmentValidator({
    hdRoutes: [
      makeRoute("foreign", [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ]),
    ],
    obstacles: [],
    layerCount: 2,
    minClearance: 0.1,
  })
  const foreignViaValidator = createStitchSegmentValidator({
    hdRoutes: [
      makeRoute(
        "foreign",
        [
          { x: 2, y: 2, z: 0 },
          { x: 3, y: 2, z: 0 },
        ],
        [{ x: 0, y: 0 }],
      ),
    ],
    obstacles: [],
    layerCount: 2,
    minClearance: 0.1,
  })

  expect(foreignTraceValidator(candidate)).toBe(false)
  expect(foreignViaValidator(candidate)).toBe(false)
})

test("stitch validator ignores same-net copper", () => {
  const validator = createStitchSegmentValidator({
    hdRoutes: [
      makeRoute("candidate", [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ]),
    ],
    obstacles: [],
    layerCount: 2,
    minClearance: 0.1,
  })

  expect(validator(candidate)).toBe(true)
})

test("stitch validator rejects foreign obstacles and permits same-net pads", () => {
  const obstacle = {
    type: "rect",
    center: { x: 0, y: 0 },
    width: 0.5,
    height: 0.5,
    layers: ["top"],
    connectedTo: ["foreign"],
  } as any
  const foreignValidator = createStitchSegmentValidator({
    hdRoutes: [],
    obstacles: [obstacle],
    layerCount: 2,
    minClearance: 0.1,
  })
  const sameNetValidator = createStitchSegmentValidator({
    hdRoutes: [],
    obstacles: [{ ...obstacle, connectedTo: ["candidate"] }],
    layerCount: 2,
    minClearance: 0.1,
  })

  expect(foreignValidator(candidate)).toBe(false)
  expect(sameNetValidator(candidate)).toBe(true)
})
