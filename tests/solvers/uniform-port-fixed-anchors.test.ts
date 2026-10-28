import { expect, test } from "bun:test"
import { redistributePortPointsBetweenFixedAnchors } from "lib/solvers/UniformPortDistributionSolver/redistributePortPointsBetweenFixedAnchors"
import { redistributePortPointsOnSharedEdge } from "lib/solvers/UniformPortDistributionSolver/redistributePortPointsOnSharedEdge"
import type { PortPointWithOwnerPair, SharedEdge } from "lib/solvers/UniformPortDistributionSolver/types"

test("fixed anchors preserve every strict same-layer order and ordinary layers retain exact legacy spacing", () => {
  const edge: SharedEdge = { ownerNodeIds: ["a", "b"], ownerPairKey: "a:b",
    orientation: "horizontal", x1: 0, x2: 1, y1: 0, y2: 0, length: 1,
    center: { x: 0.5, y: 0 }, nodeSideByOwnerId: { a: "top", b: "bottom" } }
  const points: PortPointWithOwnerPair[] = [0.9, 0.35, 0.1, 0.6, 0.8, 0.4].map((x, index) => ({
    portPointId: `p${index}`, connectionName: `n${index}`, x, y: 0, z: 0,
    ownerNodeIds: ["a", "b"], ownerPairKey: "a:b",
  }))
  points.push(...[0.1, 0.15, 0.5].map((x, index) => ({ ...points[index]!,
    portPointId: `layer1-${index}`, x, z: 1 })))
  const movable = new Set(points.filter((point) => point.x !== 0.35 && point.x !== 0.8).map((point) => point.portPointId!))
  const original = JSON.stringify(points)
  const result = redistributePortPointsBetweenFixedAnchors({ sharedEdge: edge, portPoints: points,
    movablePortPointIds: movable })
  for (const point of points) for (const other of points) {
    if (point.z !== other.z || point.x >= other.x) continue
    expect(result.find((p) => p.portPointId === point.portPointId)!.x)
      .toBeLessThan(result.find((p) => p.portPointId === other.portPointId)!.x)
  }
  for (const fixed of points.filter((p) => !movable.has(p.portPointId!))) {
    expect(result.find((p) => p.portPointId === fixed.portPointId)).toBe(fixed)
  }
  expect(result.filter((p) => p.z === 1)).toEqual(redistributePortPointsOnSharedEdge({
    sharedEdge: edge, portPoints: points.filter((p) => p.z === 1) }))
  expect(redistributePortPointsBetweenFixedAnchors({ sharedEdge: edge, portPoints: points,
    movablePortPointIds: new Set() })).toBe(points)
  expect(redistributePortPointsBetweenFixedAnchors({ sharedEdge: edge, portPoints: points,
    movablePortPointIds: new Set(points.map((p) => p.portPointId!)) }))
    .toEqual(redistributePortPointsOnSharedEdge({ sharedEdge: edge, portPoints: points }))
  expect(JSON.stringify(points)).toBe(original)
})
