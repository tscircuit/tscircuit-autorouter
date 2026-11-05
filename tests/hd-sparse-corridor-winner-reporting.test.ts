import { expect, test } from "bun:test"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("sparse wins retain their node region and concrete solver identity in high-density diagnostics", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "sparse-winner", center: { x: 0, y: 0 }, width: 6, height: 6, availableZ: [0, 1],
    portPoints: [
      { x: -2, y: -1, z: 0, connectionName: "a" }, { x: 2, y: -1, z: 0, connectionName: "a" },
      { x: -2, y: 1, z: 1, connectionName: "b" }, { x: 2, y: 1, z: 1, connectionName: "b" },
    ],
  }
  const solver = new HighDensitySolver({ nodePortPoints: [node], traceWidth: 0.15, obstacleMargin: 0.1, layerCount: 2 })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.nodeSolveMetadataById.get(node.capacityMeshNodeId)?.solverType).toBe("SparseVisibilityIntraNodeSolver")
  expect(solver.stats.solverNodeCount.SparseVisibilityIntraNodeSolver).toBe(1)
  expect(solver.routes).toHaveLength(2)
  expect(solver.routes.every((route) => route.regionId === node.capacityMeshNodeId)).toBe(true)
})
