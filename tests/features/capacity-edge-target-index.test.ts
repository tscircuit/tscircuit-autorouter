import { expect, test } from "bun:test"
import { CapacityMeshEdgeSolver } from "../../lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "../../lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import type { CapacityMeshEdge, CapacityMeshNode } from "../../lib/types/capacity-mesh-types"

const node = (id: string, x: number, z: number, target = true): CapacityMeshNode => ({
  capacityMeshNodeId: id,
  center: { x, y: 0 },
  width: 2,
  height: 2,
  layer: z === 0 ? "top" : "bottom",
  availableZ: [z],
  _containsTarget: target,
})

class OverrideEdgeSolver extends CapacityMeshEdgeSolver {
  calls: string[][] = []
  forceMissing = true
  override hasEdgeBetween(a: CapacityMeshNode, b: CapacityMeshNode): boolean {
    const pair = [a.capacityMeshNodeId, b.capacityMeshNodeId]
    this.calls.push(pair)
    if (this.forceMissing) {
      return false
    }
    return super.hasEdgeBetween(a, b)
  }
}

test("target edge indexing preserves ordered edges, public lookups, overrides and missing-routing errors", () => {
  const a = { ...node("A", 0, 0), _containsObstacle: true, _targetConnectionName: "net-A" }
  const b = node("B", 0.5, 0)
  const otherLayer = node("C", 0.5, 1)
  const distant = node("D", 10, 0)
  const free = node("free", -2, 0, false)
  const nodes = [a, b, otherLayer, distant, free]
  const before = JSON.stringify(nodes)
  const first: CapacityMeshEdge = { capacityMeshEdgeId: "ce0", nodeIds: ["A", "free"], isOffboardEdge: true, offboardNetName: "N" }
  const second: CapacityMeshEdge = { capacityMeshEdgeId: "ce1", nodeIds: ["B", "free"] }
  const solver = new CapacityMeshEdgeSolver(nodes)
  solver.edges.push(first, second)
  let globalEdgeScans = 0
  const originalSome = solver.edges.some
  Object.defineProperty(solver.edges, "some", {
    value: (...args: Parameters<typeof solver.edges.some>): boolean => {
      globalEdgeScans++
      return originalSome.apply(solver.edges, args)
    },
  })
  solver.handleTargetNodes()
  expect(globalEdgeScans).toBe(0)
  expect(solver.edges).toEqual([first, second, { capacityMeshEdgeId: "ce2", nodeIds: ["A", "B"] }])
  expect(solver.edges[0]).toBe(first)
  expect(solver.edges[1]).toBe(second)
  expect(solver.hasEdgeBetween(a, b)).toBe(true)
  expect(solver.hasEdgeBetween(b, a)).toBe(true)
  expect(solver.hasEdgeBetween(a, a)).toBe(true)
  expect(solver.hasEdgeBetween(a, otherLayer)).toBe(false)
  expect(solver.hasEdgeBetween(a, b, [])).toBe(false)
  solver.handleTargetNodes()
  expect(solver.edges.length).toBe(3)
  solver.edges.push({ capacityMeshEdgeId: "external", nodeIds: ["A", "D"] })
  expect(solver.hasEdgeBetween(a, distant)).toBe(true)
  expect(JSON.stringify(nodes)).toBe(before)

  const collisionNodes = [node("a-b", 0, 0), node("c", 0.5, 0), node("a", 10, 0), node("b-c", 10.5, 0)]
  const collision = new CapacityMeshEdgeSolver(collisionNodes)
  collision.edges.push({ capacityMeshEdgeId: "ce0", nodeIds: ["a-b", "c"] })
  collision.handleTargetNodes()
  expect(collision.edges).toEqual([
    { capacityMeshEdgeId: "ce0", nodeIds: ["a-b", "c"] },
    { capacityMeshEdgeId: "ce1", nodeIds: ["a", "b-c"] },
  ])

  const duplicateNodes = [node("same", 0, 0), node("same", 0.5, 0), node("free", -2, 0, false)]
  const duplicate = new CapacityMeshEdgeSolver(duplicateNodes)
  duplicate.edges.push({ capacityMeshEdgeId: "ce0", nodeIds: ["same", "free"] })
  duplicate.handleTargetNodes()
  expect(duplicate.edges.length).toBe(1)

  const override = new OverrideEdgeSolver([node("one", 0, 0), node("two", 0.5, 0)])
  override.edges.push({ capacityMeshEdgeId: "ce0", nodeIds: ["one", "two"] })
  override.handleTargetNodes()
  expect(override.calls).toEqual([["one", "two"]])
  expect(override.edges).toEqual([
    { capacityMeshEdgeId: "ce0", nodeIds: ["one", "two"] },
    { capacityMeshEdgeId: "ce1", nodeIds: ["one", "two"] },
  ])

  const missing = new CapacityMeshEdgeSolver([a, b])
  expect(() => missing.handleTargetNodes()).toThrow('Target obstacle region "A" for connection "net-A" has no bordering routing edge')
  expect(missing.edges).toEqual([{ capacityMeshEdgeId: "ce0", nodeIds: ["A", "B"] }])
  const optimized = new CapacityMeshEdgeSolver2_NodeTreeOptimization([node("left", 0, 0), node("right", 2, 0), node("overlap", 0.5, 0)])
  optimized.solve()
  expect(optimized.solved).toBe(true)
  expect(optimized.failed).toBe(false)
  expect(optimized.edges).toEqual([
    { capacityMeshEdgeId: "ce0", nodeIds: ["left", "right"] },
    { capacityMeshEdgeId: "ce1", nodeIds: ["left", "overlap"] },
    { capacityMeshEdgeId: "ce2", nodeIds: ["right", "overlap"] },
  ])
})
