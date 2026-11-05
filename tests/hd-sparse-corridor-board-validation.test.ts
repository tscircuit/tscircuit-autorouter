import { expect, test } from "bun:test"
import { SparseVisibilityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/SparseVisibilityIntraNodeSolver"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("sparse acceptance independently validates rotated fixed copper and the physical board edge", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "physical-board", center: { x: 0, y: 0 }, width: 6, height: 6, availableZ: [0],
    portPoints: [
      { x: -2, y: 0.5, z: 0, connectionName: "a" }, { x: 2, y: 0.5, z: 0, connectionName: "a" },
      { x: -2, y: -2, z: 0, connectionName: "b" }, { x: 2, y: -2, z: 0, connectionName: "b" },
    ],
  }
  const params = {
    nodeWithPortPoints: node, layerCount: 1, traceWidth: 0.1, obstacleMargin: 0.1,
    obstacles: [{ type: "rect" as const, layers: ["top"], connectedTo: ["foreign"], center: { x: 0, y: 0 }, width: 2, height: 0.2, ccwRotationDegrees: 45 }],
  }
  const solver = new SparseVisibilityIntraNodeSolver(params)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.boardDrcIssueCount).toBe(0)
  expect(solver.sparseDiagnostics.refinements).toBeGreaterThan(0)
  const route = solver.solvedRoutes.find((route) => route.connectionName === "a")!
  const c = Math.SQRT1_2
  const corners = [[-1, -0.1], [1, -0.1], [1, 0.1], [-1, 0.1]].map(([x, y]) => ({ x: (x! - y!) * c, y: (x! + y!) * c }))
  for (let index = 1; index < route.route.length; index++) {
    for (let edge = 0; edge < corners.length; edge++) {
      expect(minimumDistanceBetweenSegments(route.route[index - 1]!, route.route[index]!, corners[edge]!, corners[(edge + 1) % corners.length]!)).toBeGreaterThanOrEqual(0.15 - 1e-6)
    }
  }
  const clipped = new SparseVisibilityIntraNodeSolver({
    ...params,
    boardGeometry: {
      bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 }, minBoardEdgeClearance: 0.2,
      outline: [{ x: -3, y: -3 }, { x: 3, y: -3 }, { x: 3, y: -1 }, { x: -1, y: 3 }, { x: -3, y: 3 }],
    },
  })
  clipped.solve()
  expect(clipped.solved).toBe(false)
  expect(clipped.sparseDiagnostics.outcome).toBe("UNKNOWN")
  expect(clipped.stats.boardDrcIssueCount).toBeGreaterThan(0)
  expect(clipped.error).toContain("board copper validation")
})
