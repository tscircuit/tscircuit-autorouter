import { expect, test } from "bun:test"
import { RouteStitchClearanceValidator } from "lib/solvers/RouteStitchingSolver/route-stitch-clearance-validator"

test("repairs a stitch around a foreign fixed-copper obstacle", () => {
  const validator = new RouteStitchClearanceValidator({
    hdRoutes: [],
    obstacles: [
      {
        obstacleId: "foreign_pad",
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["foreign"],
      },
    ],
    layerCount: 2,
    minClearance: 0.1,
  })
  const stitchSegment = {
    connectionName: "target",
    start: { x: -0.5, y: 0, z: 0 },
    end: { x: 0.5, y: 0, z: 0 },
    traceThickness: 0.1,
  }

  expect(validator.isSegmentClear(stitchSegment)).toBe(false)
  const repairedPath = validator.findClearPath(stitchSegment)
  expect(repairedPath?.[0]).toEqual(stitchSegment.start)
  expect(repairedPath?.[1]?.x).toBe(-0.5)
  expect(repairedPath?.[1]?.y).toBeCloseTo(-0.350001)
  expect(repairedPath?.[2]?.x).toBe(0.5)
  expect(repairedPath?.[2]?.y).toBeCloseTo(-0.350001)
  expect(repairedPath?.[3]).toEqual(stitchSegment.end)
})
