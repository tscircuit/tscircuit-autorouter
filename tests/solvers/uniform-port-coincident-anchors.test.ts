import { expect, test } from "bun:test"
import { redistributePortPointsBetweenFixedAnchors } from "lib/solvers/UniformPortDistributionSolver/redistributePortPointsBetweenFixedAnchors"
import type { PortPointWithOwnerPair, SharedEdge } from "lib/solvers/UniformPortDistributionSolver/types"

test("coincident fixed anchors retain coincident ports without reversing a strict neighboring order", () => {
  const edge: SharedEdge = { ownerNodeIds: ["a", "b"], ownerPairKey: "a:b", orientation: "vertical",
    x1: 0, x2: 0, y1: 0, y2: 1, length: 1, center: { x: 0, y: 0.5 },
    nodeSideByOwnerId: { a: "right", b: "left" } }
  const points: PortPointWithOwnerPair[] = [0.1, 0.4, 0.4, 0.4, 0.9].map((y, index) => ({
    portPointId: `${index}`, connectionName: `${index}`, x: 0, y, z: 0,
    ownerNodeIds: ["a", "b"], ownerPairKey: "a:b",
  }))
  const result = redistributePortPointsBetweenFixedAnchors({ sharedEdge: edge, portPoints: points,
    movablePortPointIds: new Set(["0", "2", "4"]) })
  expect(result.map((p) => p.y)).toEqual([0.2, 0.4, 0.4, 0.4, 0.7])
  expect(result[1]).toBe(points[1])
  expect(result[2]).toBe(points[2])
  expect(result[3]).toBe(points[3])
})
