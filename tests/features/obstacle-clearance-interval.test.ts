import { expect, test } from "bun:test"
import { getObstacleClearanceInterval } from "lib/solvers/UniformPortDistributionSolver/getObstacleClearanceInterval"
import type { SharedEdge } from "lib/solvers/UniformPortDistributionSolver/types"
import type { Obstacle } from "lib/types"

test("pad clearance intervals preserve exact tangencies and rotated outlines", (): void => {
  const edge: SharedEdge = {
    ownerNodeIds: ["left", "right"],
    ownerPairKey: "left|right",
    orientation: "horizontal",
    x1: -2,
    x2: 2,
    y1: 0,
    y2: 0,
    center: { x: 0, y: 0 },
    length: 4,
    nodeSideByOwnerId: {},
  }
  const pad: Obstacle = {
    type: "rect",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    layers: ["top"],
    connectedTo: [],
  }
  const interval = getObstacleClearanceInterval(edge, pad, 0.15)!
  expect(interval.min).toBeCloseTo(-0.65, 9)
  expect(interval.max).toBeCloseTo(0.65, 9)
  expect(
    getObstacleClearanceInterval({ ...edge, y1: 0.65, y2: 0.65 }, pad, 0.15),
  ).toBeUndefined()
  const rotated = getObstacleClearanceInterval(
    edge,
    { ...pad, ccwRotationDegrees: 45 },
    0.15,
  )!
  expect(rotated.min).toBeCloseTo(-Math.SQRT1_2 - 0.15, 9)
  expect(rotated.max).toBeCloseTo(Math.SQRT1_2 + 0.15, 9)
  expect(
    getObstacleClearanceInterval({ ...edge, x1: 1.5 }, pad, 0.15),
  ).toBeUndefined()
})
