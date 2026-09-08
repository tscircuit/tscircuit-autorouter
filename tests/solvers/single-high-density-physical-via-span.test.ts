import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("center and search vias check their full physical layer span and actual diameter", (): void => {
  const index = new FixedCopperClearanceIndex({
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 0.2,
        zLayers: [1],
        ownerNetIds: new Set(["pad-net"]),
      },
    ],
    layerCount: 3,
    minClearance: 0.05,
  })
  for (const Solver of [
    SingleHighDensityRouteSolver,
    SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost,
  ]) {
    for (const viaDiameter of [0.1, 0.5]) {
      const solver = new Solver({
        connectionName: "route-net",
        obstacleRoutes: [],
        minDistBetweenEnteringPoints: 0.05,
        bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
        A: { x: -0.5, y: 0, z: 0 },
        B: { x: 0.5, y: 0, z: 2 },
        viaDiameter,
        traceThickness: 0.1,
        layerCount: 3,
        availableZ: [0, 2],
        physicalClearanceContext: {
          traceClearanceIndex: index,
          viaClearanceIndex: index,
          canonicalNetId: "route-net",
          solveToPhysicalTransform: { center: { x: 0, y: 0 }, scale: 1 },
        },
      })
      expect(solver.failed).toBeFalse()
      expect(solver.solved).toBeFalse()
      expect(solver.solvedPath).toBeNull()
      for (const z of [0, 2]) {
        const parent: Node = { x: 0, y: 0, z, g: 0, h: 0, f: 0, parent: null }
        expect(
          solver.getNeighbors(parent).some(
            (node: Node): boolean => node.z !== z,
          ),
        ).toBeFalse()
        const clearParent: Node = { ...parent, x: 0.6 }
        expect(
          solver.getNeighbors(clearParent).some(
            (node: Node): boolean => node.z !== z,
          ),
        ).toBeTrue()
        const widthParent: Node = { ...parent, x: 0.3 }
        const viaNode: Node = { ...widthParent, z: z === 0 ? 2 : 0, parent: widthParent }
        expect(solver.isNodeTooCloseToObstacle(viaNode, undefined, true)).toBe(
          viaDiameter === 0.5,
        )
      }
    }
  }
})
