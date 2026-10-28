import { expect, test } from "bun:test"
import { coalescePipeline9LayerRegions } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/coalescePipeline9LayerRegions"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { CapacityMeshNode } from "lib/types"

test("coincident free cells preserve every planar layer and shared-edge port without adding outer layers", () => {
  const nodes: CapacityMeshNode[] = [
    { capacityMeshNodeId: "inner1", center: { x: 0, y: 0 }, width: 2, height: 2,
      layer: "z1", availableZ: [1], _isComponentTopologyNode: true },
    { capacityMeshNodeId: "inner2", center: { x: 0, y: 0 }, width: 2, height: 2,
      layer: "z2", availableZ: [2], _isComponentTopologyNode: true },
    { capacityMeshNodeId: "neighbor", center: { x: -2, y: 0 }, width: 2, height: 2,
      layer: "z1,2", availableZ: [1, 2] },
  ]
  const before = JSON.stringify(nodes)
  for (const node of nodes) { Object.freeze(node.availableZ); Object.freeze(node.center); Object.freeze(node) }
  Object.freeze(nodes)
  const result = coalescePipeline9LayerRegions({ nodes, layerCount: 4, terminalConnections: [] })
  expect(result.removedNodeCount).toBe(1)
  expect(result.nodes[0]!.availableZ).toEqual([1, 2])
  expect(result.nodes[0]!.capacityMeshNodeId).toBe("inner1")
  expect(JSON.stringify(nodes)).toBe(before)
  const geometryPorts = (input: CapacityMeshNode[]): string[] => {
    const edgeSolver = new CapacityMeshEdgeSolver2_NodeTreeOptimization(input); edgeSolver.solve()
    const ports = new AvailableSegmentPointSolver({ nodes: input, edges: edgeSolver.edges,
      traceWidth: 0.1, shouldReturnCrampedPortPoints: true }); ports.solve()
    return ports.getOutput().flatMap((edge) => edge.portPoints.map((point) =>
      JSON.stringify([point.x, point.y, point.availableZ]))).sort()
  }
  expect(geometryPorts(result.nodes)).toEqual(geometryPorts(nodes))
  for (const z of [0, 1, 2, 3]) {
    for (const x of [-0.75, 0, 0.75]) for (const y of [-0.75, 0, 0.75]) {
      const covers = (input: readonly CapacityMeshNode[]): number => input.filter((node) =>
        node.availableZ.includes(z) && Math.abs(node.center.x - x) < node.width / 2 &&
        Math.abs(node.center.y - y) < node.height / 2).length
      expect(covers(result.nodes)).toBe(covers(nodes))
    }
  }
})
