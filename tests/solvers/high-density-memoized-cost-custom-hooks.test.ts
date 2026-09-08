import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

class ParentPenaltySolver extends FutureCost {
  override getFutureConnectionPenalty(node: Node, _isVia: boolean): number {
    return node.parent!.g
  }
}

class ParentClosestPointSolver extends FutureCost {
  override getClosestFutureConnectionPoint(node: Node) {
    return { x: node.parent!.g / 10, y: 0, z: node.z }
  }
}

test("custom future-cost hooks retain parent-dependent costs after a coordinate is cached", () => {
  const options = {
    connectionName: "route",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.15,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -2, y: 0, z: 0 },
    B: { x: 2, y: 0, z: 0 },
    availableZ: [0, 1],
    futureConnections: [{
      connectionName: "future",
      points: [{ x: 0.1, y: 0.1, z: 0 }, { x: 0.2, y: 0.2, z: 1 }],
    }],
  }
  for (const Solver of [ParentPenaltySolver, ParentClosestPointSolver, FutureCost]) {
    const solver = new Solver(options)
    for (const parentZ of [0, 1]) {
      for (const parentG of [1, 2, 3]) {
        const node: Node = {
          x: 0, y: 0, z: 0, g: 0, h: 0, f: 0,
          parent: { x: -0.05, y: 0, z: parentZ, g: parentG, h: 0, f: 0, parent: null },
        }
        const expectedG = solver.computeG(node)
        const expectedH = solver.computeH(node)
        solver.setNodeCosts(node)
        expect([node.g, node.h, node.f]).toEqual([
          expectedG, expectedH, solver.computeF(expectedG, expectedH),
        ])
      }
    }
    // Replacing a hook after default values have been cached must take effect,
    // and restoring both default hooks must not reuse a custom hook's result.
    const originalPenalty = solver.getFutureConnectionPenalty
    const originalClosestPoint = solver.getClosestFutureConnectionPoint
    for (const customHook of ["penalty", "closestPoint", "restored"]) {
      solver.getFutureConnectionPenalty = customHook === "penalty"
        ? ParentPenaltySolver.prototype.getFutureConnectionPenalty
        : originalPenalty
      solver.getClosestFutureConnectionPoint = customHook === "closestPoint"
        ? ParentClosestPointSolver.prototype.getClosestFutureConnectionPoint
        : originalClosestPoint
      const node: Node = {
        x: 0, y: 0, z: 0, g: 0, h: 0, f: 0,
        parent: { x: -0.05, y: 0, z: 0, g: 4, h: 0, f: 0, parent: null },
      }
      const expectedG = solver.computeG(node)
      const expectedH = solver.computeH(node)
      solver.setNodeCosts(node)
      expect([node.g, node.h]).toEqual([expectedG, expectedH])
    }
  }
})
