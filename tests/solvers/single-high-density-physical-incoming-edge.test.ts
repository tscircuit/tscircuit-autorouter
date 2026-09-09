import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

test("a blocked physical incoming edge does not close a legal destination for another parent", (): void => {
  const index = new FixedCopperClearanceIndex({
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 0.1, y: 0.1 },
        width: 0.04,
        height: 0.04,
        zLayers: [0],
        ownerNetIds: new Set(["pad-net"]),
      },
    ],
    layerCount: 2,
    minClearance: 0.02,
  })
  const solver = new SingleHighDensityRouteSolver({
    connectionName: "route-net",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.05,
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    A: { x: -0.8, y: 0, z: 0 },
    B: { x: 0.8, y: 0, z: 0 },
    traceThickness: 0.02,
    obstacleMargin: 0.1,
    availableZ: [0],
    hyperParameters: { CELL_SIZE_FACTOR: 4 },
    physicalClearanceContext: {
      traceClearanceIndex: index,
      viaClearanceIndex: index,
      traceToTraceClearance: 0.1,
      viaToTraceClearance: 0.1,
      canonicalNetId: "route-net",
      solveToPhysicalTransform: { center: { x: 0, y: 0 }, scale: 1 },
    },
  })
  const blockedParent: Node = {
    x: 0,
    y: 0,
    z: 0,
    g: 0,
    h: 0,
    f: 0,
    parent: null,
  }
  const safeParent: Node = { ...blockedParent, y: 0.2 }
  const destination: Node = { ...blockedParent, x: 0.2, y: 0.2 }
  expect(solver.cellStep).toBe(0.2)
  expect(solver.isNodeTooCloseToObstacle(destination)).toBeFalse()
  expect(
    solver
      .getNeighbors(blockedParent)
      .some(
        (node: Node): boolean =>
          node.x === destination.x && node.y === destination.y && node.z === 0,
      ),
  ).toBeFalse()
  expect(solver.exploredNodes.has(solver.getNodeKey(destination))).toBeFalse()
  expect(
    solver
      .getNeighbors(safeParent)
      .some(
        (node: Node): boolean =>
          node.x === destination.x && node.y === destination.y && node.z === 0,
      ),
  ).toBeTrue()
})
