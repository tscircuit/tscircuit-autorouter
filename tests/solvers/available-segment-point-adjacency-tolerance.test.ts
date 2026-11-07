import { expect, test } from "bun:test"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import type { CapacityMeshNode } from "lib/types"

test("accepted capacity edges retain ports across sub-micron mesh gaps", () => {
  // 0.000254 and 0.000762 mm are residual gaps at the RVboy LCD pad edges.
  const cases = [
    { gap: 0, expectedEdges: 1 },
    { gap: 0.00005, expectedEdges: 1 },
    { gap: 0.000254, expectedEdges: 1 },
    { gap: 0.000762, expectedEdges: 1 },
    { gap: 0.0011, expectedEdges: 0 },
  ]
  for (const axis of ["x", "y"] as const) {
    let continuousPortCount = 0
    for (const { gap, expectedEdges } of cases) {
      const first: CapacityMeshNode = {
        capacityMeshNodeId: "first",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        layer: "z0",
        availableZ: [0],
      }
      const second: CapacityMeshNode = {
        ...first,
        capacityMeshNodeId: "second",
        center: { x: 0, y: 0, [axis]: 1 + gap },
      }
      const nodes = [first, second]
      const edges = new CapacityMeshEdgeSolver2_NodeTreeOptimization(nodes)
      edges.solve()
      expect(edges.edges).toHaveLength(expectedEdges)
      const ports = new AvailableSegmentPointSolver({
        nodes,
        edges: edges.edges,
        traceWidth: 0.1,
        shouldReturnCrampedPortPoints: true,
      })
      ports.solve()
      expect(ports.getOutput()).toHaveLength(expectedEdges)
      const portCount = ports.getAvailablePortCountForEdge("first", "second")
      if (gap === 0) {
        continuousPortCount = portCount
        expect(continuousPortCount).toBeGreaterThan(1)
      }
      // A numerical sliver must not collapse a long boundary to one crossing.
      expect(portCount).toBe(expectedEdges ? continuousPortCount : 0)
      const unconstrainedPorts = new AvailableSegmentPointSolver({
        nodes,
        edges: edges.edges,
        traceWidth: 0.1,
        shouldReturnCrampedPortPoints: false,
      })
      unconstrainedPorts.solve()
      expect(unconstrainedPorts.getOutput()).toHaveLength(
        gap <= 0.0001 ? expectedEdges : 0,
      )

      // Numerical adjacency must not create a connection between disjoint layers.
      second.availableZ = [1]
      second.layer = "z1"
      const separateLayers = new CapacityMeshEdgeSolver2_NodeTreeOptimization(nodes)
      separateLayers.solve()
      expect(separateLayers.edges).toHaveLength(0)
    }
  }
})
