import type { Obstacle, SimpleRouteJson } from "lib/types"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"

export function createPhysicalUniformScenario({
  length = 2,
  ports = [{ portPointId: "port-a", connectionName: "a", x: 1, y: 0, z: 0 }],
  obstacles = [],
  rules = {},
}: {
  length?: number
  ports?: PortPoint[]
  obstacles?: Obstacle[]
  rules?: Partial<SimpleRouteJson>
} = {}): {
  solver: UniformPortDistributionSolver
  physicalSrj: SimpleRouteJson
  nodes: NodeWithPortPoints[]
} {
  const nodes: (NodeWithPortPoints & { availableZ: number[] })[] = [-1, 1].map(
    (y, index) => ({
      capacityMeshNodeId: index === 0 ? "lower" : "upper",
      center: { x: length / 2, y },
      width: length,
      height: 2,
      availableZ: [0, 1],
      portPoints: ports.map((port) => ({ ...port })),
      portPointsInPairs:
        ports.length > 1 ? [[{ ...ports[1]! }, { ...ports[0]! }]] : [],
    }),
  )
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({
    ...node,
    portPoints: node.portPoints.map((port) => ({
      ...port,
      portPointId: port.portPointId!,
      connectionNodeIds: ["lower", "upper"],
      distToCentermostPortOnZ: 0,
    })),
  }))
  const physicalSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles,
    connections: [
      ...new Set(
        ports.map((port) => port.rootConnectionName ?? port.connectionName),
      ),
    ].map((name) => ({
      name,
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pointId: `terminal-${name}` },
      ],
    })),
    ...rules,
  }
  return {
    physicalSrj,
    nodes,
    solver: new UniformPortDistributionSolver({
      nodeWithPortPoints: nodes,
      inputNodesWithPortPoints: inputNodes,
      layerCount: physicalSrj.layerCount,
      useLayerAwareGeometry: true,
      obstacles,
      physicalSrj,
    }),
  }
}
