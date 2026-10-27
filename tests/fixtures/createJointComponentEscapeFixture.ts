import type { JointComponentEscapePlannerInput } from "lib/solvers/JointComponentEscapePlannerSolver/JointComponentEscapePlannerSolver"
import type { PortPoint } from "lib/types/high-density-types"

export function createJointComponentEscapeFixture(): JointComponentEscapePlannerInput {
  const point = (name: string, id: string, x: number, y: number, terminal = false): PortPoint => ({
    connectionName: name, rootConnectionName: name, portPointId: id,
    x, y, z: 0, ...(terminal ? { pcb_port_id: id } : {}),
  })
  const leftA = point("A", "left-A", 0, 1)
  const leftB = point("B", "left-B", 0, -1)
  const rightA = point("A", "right-A", 10, 1)
  const rightB = point("B", "right-B", 10, -1)
  const terminals = [point("A", "terminal-left-A", -4, -1, true), point("B", "terminal-left-B", -4, 1, true),
    point("A", "terminal-right-A", 14, -1, true), point("B", "terminal-right-B", 14, 1, true)]
  const pairs: [PortPoint, PortPoint][][] = [
    [[terminals[0]!, leftA], [terminals[1]!, leftB]],
    [[leftA, rightA], [leftB, rightB]],
    [[rightA, terminals[2]!], [rightB, terminals[3]!]],
  ]
  const nodes = [
    { capacityMeshNodeId: "left", center: { x: -2.5, y: 0 }, width: 5, height: 4 },
    { capacityMeshNodeId: "area", center: { x: 5, y: 0 }, width: 10, height: 4 },
    { capacityMeshNodeId: "right", center: { x: 12.5, y: 0 }, width: 5, height: 4 },
  ]
  return {
    nodesWithPortPoints: nodes.map((node, index) => ({ ...node, availableZ: [0, 1], portPoints: pairs[index]!.flat(), portPointsInPairs: pairs[index]! })),
    inputNodesWithPortPoints: nodes.map((node, index) => ({ ...node, availableZ: [0, 1],
      portPoints: pairs[index]!.flat().filter((p) => !p.pcb_port_id).map((p) => ({ ...p,
        portPointId: p.portPointId!, distToCentermostPortOnZ: 0,
        connectionNodeIds: (p.x === 0 ? ["left", "area"] : ["area", "right"]) as [string, string],
      })),
    })),
    capacityNodes: nodes.map((node, index) => ({ ...node, availableZ: [0, 1], layer: "top", _isComponentTopologyNode: index !== 1 })),
    componentAreas: [
      { componentId: "U1", bounds: { minX: -5, maxX: 0, minY: -2, maxY: 2 } },
      { componentId: "U2", bounds: { minX: 10, maxX: 15, minY: -2, maxY: 2 } },
    ],
    connections: ["A", "B"].map((name, index) => ({ name,
      pointsToConnect: [terminals[index]!, terminals[index + 2]!].map((p) => ({ x: p.x, y: p.y, layer: "top", pcb_port_id: p.pcb_port_id })),
    })),
    obstacles: [], layerCount: 2, traceWidth: 0.2, obstacleMargin: 0.1, traceClearance: 0.1, padClearance: 0.1,
  }
}
