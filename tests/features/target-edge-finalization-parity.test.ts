import { expect, test } from "bun:test"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
} from "lib/types/capacity-mesh-types"
import { ExhaustiveTargetEdgeSolver } from "tests/fixtures/ExhaustiveTargetEdgeSolver"

class IndexedTargetEdgeSolver extends CapacityMeshEdgeSolver {
  protected override readonly targetIndexMinScanEstimate = 0
}

test("target-edge lookups preserve edge order and validation errors", (): void => {
  let seed = 472_193
  for (let trial = 0; trial < 500; trial++) {
    const nodes: CapacityMeshNode[] = []
    const edges: CapacityMeshEdge[] = []
    for (let index = 0; index < 18; index++) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      const capacityMeshNodeId = `node_${seed % 16}`
      const containsTarget = (seed & 16) !== 0
      const containsObstacle = trial % 2 === 0 && (seed & 32) !== 0
      nodes.push({
        capacityMeshNodeId,
        center: { x: (seed % 7) / 2, y: ((seed >>> 8) % 7) / 2 },
        width: 1,
        height: 1,
        layer: "top",
        availableZ: trial % 3 === 0 ? [0, 1] : [(seed >>> 12) % 2],
        _containsTarget: containsTarget,
        _containsObstacle: containsObstacle,
        _targetConnectionName: containsTarget
          ? `connection_${index}`
          : undefined,
      })
    }
    for (let index = 0; index < 40; index++) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      edges.push({
        capacityMeshEdgeId: `seed_edge_${index}`,
        nodeIds: [
          nodes[seed % nodes.length]!.capacityMeshNodeId,
          index % 7 === 0
            ? "absent_node"
            : nodes[(seed >>> 9) % nodes.length]!.capacityMeshNodeId,
        ],
      })
    }
    const beforeNodes = JSON.stringify(nodes)
    const results: Array<{ edges: CapacityMeshEdge[]; error: string | null }> =
      []
    for (const Solver of [
      ExhaustiveTargetEdgeSolver,
      CapacityMeshEdgeSolver,
      IndexedTargetEdgeSolver,
    ]) {
      const solver = new Solver(nodes)
      solver.edges = structuredClone(edges)
      let error: string | null = null
      try {
        solver.handleTargetNodes()
      } catch (caught) {
        if (!(caught instanceof Error)) throw caught
        error = caught.message
      }
      results.push({ edges: solver.edges, error })
    }
    expect(results[1]).toEqual(results[0])
    expect(results[2]).toEqual(results[0])
    expect(JSON.stringify(nodes)).toBe(beforeNodes)
  }
})
