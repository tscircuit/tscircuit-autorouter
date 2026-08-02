import { expect, test } from "bun:test"
import { redistributePortPointsOnSharedEdge } from "lib/solvers/UniformPortDistributionSolver/redistributePortPointsOnSharedEdge"
import type {
  PortPointWithOwnerPair,
  SharedEdge,
} from "lib/solvers/UniformPortDistributionSolver/types"

test("uniform port distribution respects physical trace spacing when it fits", () => {
  const sharedEdge: SharedEdge = {
    ownerNodeIds: ["left", "right"],
    ownerPairKey: "left|right",
    orientation: "vertical",
    x1: 0,
    y1: -0.185,
    x2: 0,
    y2: 0.185,
    center: { x: 0, y: 0 },
    length: 0.37,
    nodeSideByOwnerId: { left: "right", right: "left" },
  }
  const portPoints: PortPointWithOwnerPair[] = [
    {
      portPointId: "sample4-edge-port-0",
      connectionName: "source_trace_175",
      x: 0,
      y: -0.1,
      z: 5,
      ownerNodeIds: ["left", "right"],
      ownerPairKey: "left|right",
    },
    {
      portPointId: "sample4-edge-port-1",
      connectionName: "source_trace_169",
      x: 0,
      y: 0.1,
      z: 5,
      ownerNodeIds: ["left", "right"],
      ownerPairKey: "left|right",
    },
  ]

  const redistributed = redistributePortPointsOnSharedEdge({
    sharedEdge,
    portPoints,
    minimumPortSpacing: 0.2,
    minimumEdgeInset: 0.05,
  })

  expect(redistributed[1]!.y - redistributed[0]!.y).toBeCloseTo(0.2)
  expect(redistributed[0]!.y - sharedEdge.y1).toBeCloseTo(0.085)
  expect(sharedEdge.y2 - redistributed[1]!.y).toBeCloseTo(0.085)
})
