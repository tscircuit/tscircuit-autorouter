import { expect, test } from "bun:test"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("opt-in boundary order leaves ordinary all-movable and all-fixed families exactly unchanged", () => {
  const ports = [0.1, 0.15, 1.5, 0.5, 1.2].map((x, index) => ({
    portPointId: `p${index}`, connectionName: `n${index}`, x, y: 0, z: index % 2,
  }))
  const nodes: NodeWithPortPoints[] = [-1, 1].map((y, index) => ({
    capacityMeshNodeId: index === 0 ? "lower" : "upper", center: { x: 1, y },
    width: 2, height: 2, availableZ: [0, 1], portPoints: ports.map((point) => ({ ...point })),
  }))
  for (const fixed of [false, true]) {
    const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({ ...node,
      _containsTarget: fixed, availableZ: [0, 1],
      portPoints: node.portPoints.map((point) => ({ ...point, portPointId: point.portPointId!,
        connectionNodeIds: ["lower", "upper"], distToCentermostPortOnZ: 0 })),
    }))
    const output = [false, true].map((preserveBoundaryPortOrder) => {
      const solver = new UniformPortDistributionSolver({ nodeWithPortPoints: nodes,
        inputNodesWithPortPoints: inputNodes, useLayerAwareGeometry: true,
        preserveBoundaryPortOrder, layerCount: 4, obstacles: [] })
      solver.solve()
      expect(solver.solved).toBe(true)
      return solver.getOutput()
    })
    expect(output[1]).toEqual(output[0])
    if (fixed) expect(output[1]).toEqual(nodes)
  }
})
