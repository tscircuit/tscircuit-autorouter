import { expect, test } from "bun:test"
import { redistributePortPointsOnSharedEdge } from "lib/solvers/UniformPortDistributionSolver/redistributePortPointsOnSharedEdge"
import type {
  OwnerPairKey,
  PortPointId,
  PortPointWithOwnerPair,
  SharedEdge,
} from "lib/solvers/UniformPortDistributionSolver/types"

test("fails when fixed copper leaves no legal coordinate on the shared edge", () => {
  const ownerPairKey = "left|right" as OwnerPairKey
  const portPointId = "blocked-port" as PortPointId
  const sharedEdge: SharedEdge = {
    ownerNodeIds: ["left", "right"],
    ownerPairKey,
    orientation: "vertical",
    x1: 0,
    y1: -1,
    x2: 0,
    y2: 1,
    center: { x: 0, y: 0 },
    length: 2,
    nodeSideByOwnerId: { left: "right", right: "left" },
  }
  const portPoint: PortPointWithOwnerPair = {
    portPointId,
    connectionName: "target-net",
    x: 0,
    y: 0,
    z: 0,
    ownerNodeIds: ["left", "right"],
    ownerPairKey,
  }

  expect(() =>
    redistributePortPointsOnSharedEdge({
      sharedEdge,
      portPoints: [portPoint],
      reservedIntervalsByPortPointId: new Map([
        [portPointId, [{ min: -1, max: 1 }]],
      ]),
      minimumSpacing: 0.2,
    }),
  ).toThrow(
    'Uniform port distribution cannot place [blocked-port] on shared edge "left|right" at z=0',
  )
})
