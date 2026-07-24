import { expect, test } from "bun:test"
import { createStitchSegmentRouter } from "lib/solvers/RouteStitchingSolver/create-stitch-segment-validator"
import type { Obstacle } from "lib/types"
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

test("stitch validator handles trace, via, same-net, and obstacle copper", () => {
  const foreignTraceValidator = createStitchSegmentRouter({
    hdRoutes: [
      makeRoute("foreign", [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ]),
    ],
    obstacles: [],
    layerCount: 2,
    minClearance: 0.1,
  }).isValidSegment
  const foreignViaValidator = createStitchSegmentRouter({
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
  }).isValidSegment
  const sameNetValidator = createStitchSegmentRouter({
    hdRoutes: [
      makeRoute("candidate", [
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ]),
    ],
    obstacles: [],
    layerCount: 2,
    minClearance: 0.1,
  }).isValidSegment
  const obstacle: Obstacle = {
    type: "rect",
    center: { x: 0, y: 0 },
    width: 0.5,
    height: 0.5,
    layers: ["top"],
    connectedTo: ["foreign"],
  }
  const foreignObstacleValidator = createStitchSegmentRouter({
    hdRoutes: [],
    obstacles: [obstacle],
    layerCount: 2,
    minClearance: 0.1,
  }).isValidSegment
  const sameNetObstacleValidator = createStitchSegmentRouter({
    hdRoutes: [],
    obstacles: [{ ...obstacle, connectedTo: ["candidate"] }],
    layerCount: 2,
    minClearance: 0.1,
  }).isValidSegment

  expect(foreignTraceValidator(candidate)).toBe(false)
  expect(foreignViaValidator(candidate)).toBe(false)
  expect(sameNetValidator(candidate)).toBe(true)
  expect(foreignObstacleValidator(candidate)).toBe(false)
  expect(sameNetObstacleValidator(candidate)).toBe(true)
})
