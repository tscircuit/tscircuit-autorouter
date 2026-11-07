import type { CapacityMeshNode, SimpleRouteConnection } from "lib/types"
import { getConnectionPointLayers } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import type { SegmentPortPoint } from "./AvailableSegmentPointSolver"

type OrdinaryEscapeInput = {
  target: CapacityMeshNode
  nodes: CapacityMeshNode[]
  nodeMap: Map<string, CapacityMeshNode>
  ordinaryPorts: Map<string, SegmentPortPoint[]>
  connections: SimpleRouteConnection[]
}

/** Nearby free space can be an isolated pocket; check the actual destinations. */
export function doesOrdinaryEscapeReachConnection({
  target,
  nodes,
  nodeMap,
  ordinaryPorts,
  connections,
}: OrdinaryEscapeInput): boolean {
  const layerCount = nodes.reduce(
    (count, node) => Math.max(count, ...node.availableZ.map((z) => z + 1)),
    1,
  )
  const containsPoint = (
    node: CapacityMeshNode,
    point: SimpleRouteConnection["pointsToConnect"][number],
  ): boolean => {
    const pointLayers = getConnectionPointLayers(point)
    return (
      Math.abs(point.x - node.center.x) <= node.width / 2 + 1e-9 &&
      Math.abs(point.y - node.center.y) <= node.height / 2 + 1e-9 &&
      pointLayers.some((layer) =>
        node.availableZ.includes(mapLayerNameToZ(layer, layerCount)),
      )
    )
  }
  const destinations = connections
    .filter((connection) =>
      connection.pointsToConnect.some((point) => containsPoint(target, point)),
    )
    .flatMap((connection) => connection.pointsToConnect)
    .filter((point) => !containsPoint(target, point))
    .map(
      (point) =>
        new Set(
          nodes
            .filter((node) => containsPoint(node, point))
            .map((node) => node.capacityMeshNodeId),
        ),
    )
    // Component-local endpoints are absent from the cramped-port stage's
    // graph. Their planned exits are preserved separately by the pipeline.
    .filter((group) => group.size > 0)
  if (destinations.length === 0) return true
  const destinationNodes = new Set(destinations.flatMap((group) => [...group]))
  const destinationGroupsByNode = new Map<string, number[]>()
  destinations.forEach((group, index) => {
    for (const nodeId of group) {
      const groups = destinationGroupsByNode.get(nodeId) ?? []
      groups.push(index)
      destinationGroupsByNode.set(nodeId, groups)
    }
  })
  const reachedGroups = new Set<number>()
  const targetNetIds = new Set(target._connectedTo)
  const visited = new Set([target.capacityMeshNodeId])
  const queue = [target.capacityMeshNodeId]
  for (let index = 0; index < queue.length; index++) {
    const nodeId = queue[index]!
    for (const port of ordinaryPorts.get(nodeId) ?? []) {
      if (port.cramped) continue
      for (const neighborId of port.nodeIds) {
        if (visited.has(neighborId)) continue
        const neighbor = nodeMap.get(neighborId)!
        const sameNet = neighbor._connectedTo?.some((net) =>
          targetNetIds.has(net),
        )
        if (
          neighbor._containsObstacle &&
          !sameNet &&
          !destinationNodes.has(neighborId)
        ) {
          continue
        }
        visited.add(neighborId)
        for (const group of destinationGroupsByNode.get(neighborId) ?? []) {
          reachedGroups.add(group)
        }
        if (reachedGroups.size === destinations.length) return true
        queue.push(neighborId)
      }
    }
  }
  return false
}
