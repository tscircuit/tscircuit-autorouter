import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

test("solve-space scaling preserves physical copper widths and copied transform coordinates", (): void => {
  const index = new FixedCopperClearanceIndex({
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 10, y: -4 },
        width: 0.4,
        height: 0.4,
        zLayers: [0],
        ownerNetIds: new Set(["pad-net"]),
      },
    ],
    layerCount: 2,
    minClearance: 0.05,
  })
  for (const traceThickness of [0.2, 0.4]) {
    const center = { x: 10, y: -4 }
    const transform = { center, scale: 0.5 }
    const solver = new SingleHighDensityRouteSolver({
      connectionName: "route-net",
      obstacleRoutes: [],
      minDistBetweenEnteringPoints: 0.05,
      bounds: { minX: 8, maxX: 12, minY: -6, maxY: -2 },
      A: { x: 8, y: -4, z: 0 },
      B: { x: 12, y: -4, z: 0 },
      traceThickness,
      physicalClearanceContext: {
        traceClearanceIndex: index,
        viaClearanceIndex: index,
        canonicalNetId: "route-net",
        solveToPhysicalTransform: transform,
      },
    })
    const node: Node = {
      x: 10.8,
      y: -4,
      z: 0,
      g: 0,
      h: 0,
      f: 0,
      parent: null,
    }
    expect(solver.solved).toBeFalse()
    expect(solver.failed).toBeFalse()
    expect(solver.isNodeTooCloseToObstacle(node)).toBe(traceThickness === 0.4)
    expect(solver.traceThickness).toBe(traceThickness)
    center.x = 100
    transform.scale = 2
    expect(solver.isNodeTooCloseToObstacle(node)).toBe(traceThickness === 0.4)
    const parent: Node = { ...node, x: 9 }
    expect(
      solver.doesPathToParentIntersectObstacle({ ...node, parent }),
    ).toBeTrue()
  }
})
