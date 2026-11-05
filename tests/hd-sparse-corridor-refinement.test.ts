import { expect, test } from "bun:test"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { SparseVisibilityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/SparseVisibilityIntraNodeSolver"

test("blocked visibility edges introduce boundary events instead of a uniform grid", () => {
  const counters: Record<string, number> = {}
  const solver = new SparseVisibilityIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "obstacle", center: { x: 0, y: 0 }, width: 6, height: 6, availableZ: [0],
      portPoints: [
        { x: -2, y: 0, z: 0, connectionName: "a" }, { x: 2, y: 0, z: 0, connectionName: "a" },
        { x: -2, y: 2, z: 0, connectionName: "b" }, { x: 2, y: 2, z: 0, connectionName: "b" },
      ],
    },
    layerCount: 1, traceWidth: 0.15, obstacleMargin: 0.1, priorityDiagnostics: counters,
    obstacles: [{ type: "rect", layers: ["top"], connectedTo: [], center: { x: 0, y: 0 }, width: 1, height: 1 }],
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.sparseDiagnostics.events).toBeGreaterThan(0)
  expect(solver.sparseDiagnostics.events).toBeLessThan(128)
  expect(counters.sparseGeometryTests).toBe(solver.sparseDiagnostics.geometryTests)
  expect(counters.sparseWins).toBe(1)
  const points = solver.solvedRoutes.find((route) => route.connectionName === "a")!.route
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!, b = points[index]!
    for (const [p, q] of [[{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }], [{ x: -0.5, y: 0.5 }, { x: 0.5, y: 0.5 }], [{ x: -0.5, y: -0.5 }, { x: -0.5, y: 0.5 }], [{ x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }]]) {
      expect(minimumDistanceBetweenSegments(a, b, p!, q!)).toBeGreaterThanOrEqual(0.175 - 1e-6)
    }
  }
})
