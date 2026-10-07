import { expect, test } from "bun:test"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import type { CapacityMeshNode } from "lib/types"

const createNode = (
  capacityMeshNodeId: string,
  center: { x: number; y: number },
  availableZ: number[] = [0],
): CapacityMeshNode => ({
  capacityMeshNodeId,
  center,
  width: 1,
  height: 1,
  layer: "top",
  availableZ,
})

test("target overlap edges are complete and are not duplicated", () => {
  const routeNode = createNode("route", { x: 0, y: 0 })
  const targetA: CapacityMeshNode = {
    ...createNode("target_a", { x: 1, y: 0 }),
    _containsTarget: true,
    _containsObstacle: true,
    _targetConnectionName: "signal",
  }
  const overlappingTarget: CapacityMeshNode = {
    ...createNode("target_overlap", { x: 1, y: 0 }),
    _containsTarget: true,
  }
  const touchingTarget: CapacityMeshNode = {
    ...createNode("target_touch", { x: 2, y: 0 }),
    _containsTarget: true,
  }
  const wrongLayerTarget: CapacityMeshNode = {
    ...createNode("target_wrong_layer", { x: 1, y: 0 }, [1]),
    _containsTarget: true,
  }
  const farTarget: CapacityMeshNode = {
    ...createNode("target_far", { x: 10, y: 0 }),
    _containsTarget: true,
  }
  const solver = new CapacityMeshEdgeSolver2_NodeTreeOptimization([
    routeNode,
    targetA,
    overlappingTarget,
    touchingTarget,
    wrongLayerTarget,
    farTarget,
  ])

  solver.solve()

  const nodePairs = solver.edges.map((edge) =>
    [...edge.nodeIds].sort().join("-"),
  )
  expect(nodePairs).toEqual([
    "route-target_a",
    "route-target_overlap",
    "target_a-target_touch",
    "target_overlap-target_touch",
    "target_a-target_overlap",
  ])
  expect(new Set(nodePairs).size).toBe(nodePairs.length)
})
