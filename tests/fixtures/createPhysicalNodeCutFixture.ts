import type { PhysicalNodeCutContext } from "lib/solvers/NodeDimensionSubdivisionSolver/physicalNodeCuts"
import type { CapacityMeshNode } from "lib/types"

export const createPhysicalNodeCutFixture = (): {
  node: CapacityMeshNode
  context: PhysicalNodeCutContext
} => {
  return {
    node: {
      capacityMeshNodeId: "ordinary-node",
      center: { x: 0, y: 0 },
      width: 2,
      height: 8,
      layer: "top",
      availableZ: [0, 1],
    },
    context: {
      layerCount: 2,
      traceWidth: 0.125,
      traceGap: 0.125,
      padGap: 0.0625,
      routableNetIds: new Set(["route-a", "route-b"]),
      protectedPoints: [],
      rectangles: [
        {
          kind: "fixed-rectangle",
          center: { x: 1.5, y: 0 },
          width: 1,
          height: 2,
          zLayers: [1],
          ownerNetIds: new Set(["foreign-pad"]),
        },
      ],
    },
  }
}
