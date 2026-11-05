import { expect, test } from "bun:test"
import { SparseVisibilityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/SparseVisibilityIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("sparse visibility preserves a physically open narrow channel and reports UNKNOWN when it closes", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "narrow", center: { x: 0, y: 0 }, width: 6, height: 6,
    availableZ: [0],
    portPoints: [
      { x: -2, y: 0, z: 0, connectionName: "a" },
      { x: 2, y: 0, z: 0, connectionName: "a" },
      { x: -2, y: -2.7, z: 0, connectionName: "b" },
      { x: -1, y: -2.7, z: 0, connectionName: "b" },
    ],
  }
  for (const gap of [0.36, 0.34]) {
    const height = 3 - gap / 2
    const obstacles: Obstacle[] = [-1, 1].map((sign) => ({
      type: "rect", layers: ["top"], connectedTo: [], width: 0.6, height,
      center: { x: 0, y: sign * (gap / 2 + height / 2) },
    }))
    const solver = new SparseVisibilityIntraNodeSolver({ nodeWithPortPoints: node, obstacles, layerCount: 1, traceWidth: 0.15, obstacleMargin: 0.1 })
    solver.solve()
    expect(solver.solved).toBe(gap === 0.36)
    if (solver.solved) {
      expect(solver.solvedRoutes.find((route) => route.connectionName === "a")!.route).toHaveLength(2)
    } else {
      expect(solver.error).toContain("UNKNOWN")
      expect(solver.sparseDiagnostics.refinements).toBeGreaterThan(0)
    }
  }
})
