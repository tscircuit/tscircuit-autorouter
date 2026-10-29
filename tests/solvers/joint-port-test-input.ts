import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"

export function createJointPortTestInput(
  sharedCoordinates: number[] = [0],
  targets: number[] = [1],
): { nodes: NodeWithPortPoints[]; inputNodes: InputNodeWithPortPoints[]; srj: SimpleRouteJson } {
  const nodes: NodeWithPortPoints[] = ["left", "right"].map((id, side) => {
    const pairs = sharedCoordinates.map((y, i): [PortPoint, PortPoint] => {
      const shared: PortPoint = { portPointId: `shared-${i}`, connectionName: `net-${i}`,
        rootConnectionName: `root-${i}`, x: 0, y, z: 0,
        prevPortPointId: `start-${i}`, nextPortPointId: `end-${i}` }
      const endpoint: PortPoint = { portPointId: `${id}-end-${i}`,
        pcb_port_id: `${id}-terminal-${i}`, connectionName: `net-${i}`,
        rootConnectionName: `root-${i}`, x: (side === 0 ? -1 : 1) * (4 - i),
        y: targets[i], z: 0 }
      return side === 0 ? [endpoint, shared] : [shared, endpoint]
    })
    return { capacityMeshNodeId: id, center: { x: side === 0 ? -2 : 2, y: 0 },
      width: 4, height: 4, availableZ: [0, 1], portPoints: pairs.flat(), portPointsInPairs: pairs }
  })
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({
    ...node, availableZ: [0, 1], portPoints: node.portPoints.map((point) => ({
      portPointId: point.portPointId!, x: point.x, y: point.y, z: point.z,
      distToCentermostPortOnZ: 0,
      connectionNodeIds: point.portPointId!.startsWith("shared-")
        ? ["left", "right"] : [node.capacityMeshNodeId, node.capacityMeshNodeId],
    })),
  }))
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1,
    defaultObstacleMargin: 0.15, bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    obstacles: [], connections: sharedCoordinates.map((_, i) => ({ name: `net-${i}`,
      pointsToConnect: nodes.map((node) => {
        const point = node.portPoints.find((port) => port.portPointId === `${node.capacityMeshNodeId}-end-${i}`)!
        return { x: point.x, y: point.y, layer: "top", pcb_port_id: point.pcb_port_id }
      }),
    })) }
  return { nodes, inputNodes, srj }
}
