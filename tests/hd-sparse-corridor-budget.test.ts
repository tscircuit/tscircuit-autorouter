import { expect, test } from "bun:test"
import { SparseVisibilityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/SparseVisibilityIntraNodeSolver"

test("sparse work and virtual-scale limits remain UNKNOWN rather than infeasibility certificates", () => {
  const params = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "bounded", center: { x: 0, y: 0 }, width: 6, height: 6, availableZ: [0, 1],
      portPoints: [
        { x: -2, y: 0, z: 0, connectionName: "a" }, { x: 2, y: 0, z: 0, connectionName: "a" },
        { x: 0, y: -2, z: 0, connectionName: "b" }, { x: 0, y: 2, z: 0, connectionName: "b" },
      ],
    },
    layerCount: 2,
  }
  const bounded = new SparseVisibilityIntraNodeSolver({ ...params, maxGeometryTests: 1 })
  bounded.solve()
  expect(bounded.solved).toBe(false)
  expect(bounded.error).toContain("UNKNOWN")
  expect(bounded.sparseDiagnostics.geometryTests).toBeLessThanOrEqual(2)
  expect(bounded.sparseDiagnostics.broadphaseTests).toBeLessThanOrEqual(11)
  const virtual = new SparseVisibilityIntraNodeSolver({ ...params, priorityCoordinateScale: 2 })
  expect(virtual.failed).toBe(true)
  expect(virtual.sparseDiagnostics.outcome).toBe("UNKNOWN")
  expect(virtual.sparseDiagnostics.geometryTests).toBe(0)
  expect(virtual.error).toContain("physical-scale")
})
