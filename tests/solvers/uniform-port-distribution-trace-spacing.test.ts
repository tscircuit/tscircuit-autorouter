import { expect, test } from "bun:test"
import { redistributePortPointsOnSharedEdge } from "lib/solvers/UniformPortDistributionSolver/redistributePortPointsOnSharedEdge"
import type {
  PortPointWithOwnerPair,
  SharedEdge,
} from "lib/solvers/UniformPortDistributionSolver/types"

test("boundary redistribution meets trace spacing without changing port order or admitting impossible capacity", () => {
  const sharedEdge: SharedEdge = {
    ownerNodeIds: ["above", "below"],
    ownerPairKey: "above|below",
    orientation: "horizontal",
    x1: 0,
    y1: 1,
    x2: 0.44,
    y2: 1,
    center: { x: 0.22, y: 1 },
    length: 0.44,
    nodeSideByOwnerId: { above: "bottom", below: "top" },
  }
  const portPoints: PortPointWithOwnerPair[] = [0, 1, 2].map((index) => ({
    portPointId: `port_${index}`,
    connectionName: `net_${index}`,
    ownerNodeIds: ["above", "below"],
    ownerPairKey: "above|below",
    x: 0.21 + index * 0.01,
    y: 1,
    z: 0,
  }))
  const redistributed = redistributePortPointsOnSharedEdge({
    sharedEdge,
    portPoints,
    minTraceCenterSpacing: 0.2,
  })
  expect(redistributed.map((port) => port.portPointId)).toEqual(
    portPoints.map((port) => port.portPointId),
  )
  for (const [index, port] of redistributed.entries()) {
    expect(port.x).toBeCloseTo(0.02 + index * 0.2, 10)
    expect(port.y).toBe(1)
  }
  expect(() =>
    redistributePortPointsOnSharedEdge({
      sharedEdge: { ...sharedEdge, x2: 0.3, length: 0.3 },
      portPoints,
      minTraceCenterSpacing: 0.2,
    }),
  ).toThrow("cannot fit 3 ports")
  const roomyEdge = {
    ...sharedEdge,
    x2: 3,
    length: 3,
    center: { x: 1.5, y: 1 },
  }
  expect(
    redistributePortPointsOnSharedEdge({
      sharedEdge: roomyEdge,
      portPoints,
      minTraceCenterSpacing: 0.2,
    }),
  ).toEqual(
    redistributePortPointsOnSharedEdge({ sharedEdge: roomyEdge, portPoints }),
  )
})
