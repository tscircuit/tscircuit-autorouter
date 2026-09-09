import { expect, test } from "bun:test"
import { getFixedCopperClearanceIntervals } from "lib/solvers/UniformPortDistributionSolver/getFixedCopperClearanceIntervals"

test("rotated copper intervals use analytic geometry and distance from either edge orientation", (): void => {
  const shapes = [
    { width: 2, height: 2, reach: Math.SQRT2 + 0.5 },
    { width: 4, height: 0.5, reach: 0.75 * Math.SQRT2 },
  ]
  const edges = [
    { start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, centerDistance: 3 },
    { start: { x: 10, y: 0 }, end: { x: 0, y: 0 }, centerDistance: 7 },
    { start: { x: 3, y: -5 }, end: { x: 3, y: 5 }, centerDistance: 5 },
  ]
  for (const shape of shapes) {
    for (const edge of edges) {
      const intervals = getFixedCopperClearanceIntervals({
        start: edge.start,
        end: edge.end,
        z: 0,
        layerCount: 2,
        canonicalNetId: "route-net",
        copperDiameter: 1,
        minClearance: 0,
        rectangles: [
          {
            kind: "fixed-rectangle",
            center: { x: 3, y: 0 },
            width: shape.width,
            height: shape.height,
            ccwRotationDegrees: 45,
            zLayers: [0],
            ownerNetIds: new Set(["pad-net"]),
          },
        ],
      })
      expect(intervals).toHaveLength(2)
      expect(intervals[0]!.start).toBe(0)
      expect(intervals[0]!.end).toBeCloseTo(
        edge.centerDistance - shape.reach,
        12,
      )
      expect(intervals[1]!.start).toBeCloseTo(
        edge.centerDistance + shape.reach,
        12,
      )
      expect(intervals[1]!.end).toBe(10)
    }
  }
})
