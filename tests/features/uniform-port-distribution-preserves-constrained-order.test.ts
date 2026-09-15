import { expect, test } from "bun:test"
import { redistributePortPointsOnSharedEdge } from "lib/solvers/UniformPortDistributionSolver/redistributePortPointsOnSharedEdge"
import type {
  OwnerPairKey,
  PortPointId,
  PortPointWithOwnerPair,
  SharedEdge,
} from "lib/solvers/UniformPortDistributionSolver/types"

test("does not collapse a later port when copper pushes an earlier port past its ideal", () => {
  const ownerPairKey = "left|right" as OwnerPairKey
  const firstPortPointId = "first-port" as PortPointId
  const secondPortPointId = "second-port" as PortPointId
  const sharedEdge: SharedEdge = {
    ownerNodeIds: ["left", "right"],
    ownerPairKey,
    orientation: "vertical",
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 10,
    center: { x: 0, y: 5 },
    length: 10,
    nodeSideByOwnerId: { left: "right", right: "left" },
  }
  const firstPortPoint: PortPointWithOwnerPair = {
    portPointId: firstPortPointId,
    connectionName: "target-net",
    x: 0,
    y: 8,
    z: 0,
    ownerNodeIds: ["left", "right"],
    ownerPairKey,
  }
  const secondPortPoint: PortPointWithOwnerPair = {
    ...firstPortPoint,
    portPointId: secondPortPointId,
    y: 9,
  }

  const redistributedPortPoints = redistributePortPointsOnSharedEdge({
    sharedEdge,
    portPoints: [firstPortPoint, secondPortPoint],
    reservedIntervalsByPortPointId: new Map([
      [firstPortPointId, [{ min: 0, max: 7 }]],
    ]),
  })

  expect(redistributedPortPoints.map((portPoint) => portPoint.y)).toEqual([
    8, 9,
  ])
})
