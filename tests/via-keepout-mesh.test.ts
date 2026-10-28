import { expect, test } from "bun:test"
import { splitNodesAtViaKeepouts } from "../lib/utils/splitNodesAtViaKeepouts"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "../lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import type { CapacityMeshNode } from "../lib/types/capacity-mesh-types"

test("via-only regions preserve planar connectivity on both layers", () => {
  const nodes: CapacityMeshNode[] = [-3, 0, 3].map((x, i) => ({ capacityMeshNodeId: `n${i}`, center: { x, y: 0 }, width: 3, height: 3, layer: "top", availableZ: [0, 1] }))
  expect(splitNodesAtViaKeepouts(nodes, [], 0.6, 2)).toBe(nodes)
  const split = splitNodesAtViaKeepouts(nodes, [{ shape: "rect", center: { x: 0, y: 0 }, width: 1, height: 1, layers: ["bottom"] }], 0.6, 2)
  const centerNodes = split.filter(n => Math.abs(n.center.x) <= n.width/2 && Math.abs(n.center.y) <= n.height/2)
  expect(centerNodes.length).toBeGreaterThan(0)
  expect(centerNodes.every(n => n.availableZ.length === 1)).toBe(true)
  expect([...new Set(centerNodes.flatMap(n => n.availableZ))].sort()).toEqual([0,1])
  for (const z of [0,1]) expect(split.filter(n => n.availableZ.includes(z)).reduce((area,n) => area+n.width*n.height,0)).toBeCloseTo(27,8)
  expect(split[0]).toBe(nodes[0])
  expect(split[split.length - 1]).toBe(nodes[2])
  const edges = new CapacityMeshEdgeSolver2_NodeTreeOptimization(split)
  edges.solve()
  expect(edges.edges.length).toBeGreaterThan(4)
  expect(split.some(n => n.center.x > -1.5 && n.center.x < 1.5 && n.availableZ.length === 2)).toBe(true)
  for (const edge of edges.edges) {
    const pair = edge.nodeIds.map(id => split.find(n => n.capacityMeshNodeId === id)!)
    expect(pair[0].availableZ.some(z => pair[1].availableZ.includes(z))).toBe(true)
  }
})
