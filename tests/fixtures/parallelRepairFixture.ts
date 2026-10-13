import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

export function createParallelRepairFixture(): {
  nodeWithPortPoints: NodeWithPortPoints[]
  hdRoutes: HighDensityRoute[]
  obstacles: Obstacle[]
  minimumTraceWidth: number
} {
  const nodes: NodeWithPortPoints[] = Array.from({ length: 5 }, (_, index) => ({
    capacityMeshNodeId: `node-${index}`,
    center: { x: index * 2.1, y: 0 },
    width: 2,
    height: 2,
    portPoints: [],
    availableZ: [0, 1],
  }))
  return {
    nodeWithPortPoints: nodes,
    minimumTraceWidth: 0.4,
    hdRoutes: nodes.map((node, index) => ({
      connectionName: `trace-${index}`,
      regionId: node.capacityMeshNodeId,
      startPcbPortId: `start-${index}`,
      endPcbPortId: `end-${index}`,
      rootConnectionName: `net-${index}`,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: node.center.x - 1, y: 0, z: 0 },
        { x: node.center.x, y: 0, z: 0 },
        { x: node.center.x + 1, y: 0, z: 0 },
      ],
    })),
    obstacles: nodes.map((node) => ({
      type: "rect",
      center: { x: node.center.x, y: 0.3 },
      width: 0.1,
      height: 0.1,
      layers: ["top"],
      connectedTo: [],
    })),
  }
}
