import { expect, test } from "bun:test"
import { SharedOwnershipGraphSolver, type OwnershipGraph } from "lib/solvers/HyperHighDensitySolver/SharedOwnershipGraphSolver"

test("owner-independent drill proofs forbid close same-net sites while retaining exact shared-site reuse", () => {
  for (const separation of [0, 0.2, 0.4]) {
    const graph: OwnershipGraph = {
      vertices: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3 }, { x: separation, y: 0, z: 0 }, { x: separation, y: 0, z: 3 }],
      adjacency: [[{ to: 1, primitive: 0, cost: 1 }], [], [{ to: 3, primitive: 1, cost: 1 }], []],
    }
    const solver = new SharedOwnershipGraphSolver({
      graph, tasks: [{ connectionName: "pair-a", owner: "root", start: 0, end: 1 }, { connectionName: "pair-b", owner: "root", start: 2, end: 3 }],
      primitivesConflict: (): boolean => false, permanentlyBlocked: (): boolean => false,
      ownerIndependentConflicts: {
        primitiveIds: new Set([0, 1]),
        conflict: (left, right): boolean => {
          const a = graph.vertices[left === 0 ? 0 : 2]!, b = graph.vertices[right === 0 ? 0 : 2]!
          const distance = Math.hypot(a.x - b.x, a.y - b.y)
          return distance > 1e-9 && distance < 0.4 - 1e-9
        },
      }, maxIterations: 1000,
    })
    solver.solve()
    expect(solver.solved).toBe(separation !== 0.2)
    if (separation === 0.2) {
      expect(solver.learnedClauses[0]).toEqual({ owners: [{ task: 0, primitive: 0 }], exclusions: [] })
      expect(solver.counters.ownershipGraphDrillGeometryConflictCount).toBe(1)
    } else {
      expect(solver.paths).toHaveLength(2)
      expect(solver.learnedClauses).toHaveLength(0)
    }
  }
})
