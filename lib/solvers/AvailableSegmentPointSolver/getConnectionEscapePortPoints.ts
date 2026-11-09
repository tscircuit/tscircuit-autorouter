import type {
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteConnection,
} from "lib/types"
import { getConnectionPointLayers } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import type {
  OrdinaryPortAvailability,
  SegmentPortPoint,
} from "./AvailableSegmentPointSolver"
import type { ConnectionEscapeIndex } from "./getConnectionEscapeIndex"

type ConnectionEscapeInput = {
  target: CapacityMeshNode
  nodes: CapacityMeshNode[]
  nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>
  portsByNodeId: Map<CapacityMeshNodeId, SegmentPortPoint[]>
  connections: SimpleRouteConnection[]
  allowCrampedPortPoints?: boolean
  escapeIndex?: ConnectionEscapeIndex
  isOrdinaryPortAvailable?: OrdinaryPortAvailability
}

function getAdjacentFreeSpaceComponents({
  nodeIds,
  portsByNodeId,
  freeSpaceComponentIds,
}: {
  nodeIds: Iterable<CapacityMeshNodeId>
  portsByNodeId: Map<CapacityMeshNodeId, SegmentPortPoint[]>
  freeSpaceComponentIds: Map<CapacityMeshNodeId, CapacityMeshNodeId>
}): Set<CapacityMeshNodeId> {
  const components = new Set<CapacityMeshNodeId>()
  for (const nodeId of nodeIds) {
    const ownComponent = freeSpaceComponentIds.get(nodeId)
    if (ownComponent !== undefined) components.add(ownComponent)
    for (const port of portsByNodeId.get(nodeId) ?? []) {
      if (port.cramped) continue
      for (const neighborId of port.nodeIds) {
        const component = freeSpaceComponentIds.get(neighborId)
        if (component !== undefined) components.add(component)
      }
    }
  }
  return components
}

/** Return required cramped crossings, or undefined if destinations are unreachable. */
export function getConnectionEscapePortPoints({
  target,
  nodes,
  nodeMap,
  portsByNodeId,
  connections,
  allowCrampedPortPoints = false,
  escapeIndex,
  isOrdinaryPortAvailable,
}: ConnectionEscapeInput): Set<SegmentPortPoint> | undefined {
  const layerCount =
    escapeIndex?.layerCount ??
    nodes.reduce(
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
    .map((point) => {
      let candidates = nodes
      if (escapeIndex) {
        candidates = escapeIndex.nodeTree.getNodesInArea(
          point.x,
          point.y,
          2e-9,
          2e-9,
        )
      }
      return new Set(
        candidates
          .filter((node) => containsPoint(node, point))
          .map((node) => node.capacityMeshNodeId),
      )
    })
    .filter((group) => group.size > 0)
  if (destinations.length === 0) return new Set()
  // A shared free component proves an escape without crossing another net's pad.
  if (escapeIndex && !allowCrampedPortPoints && !isOrdinaryPortAvailable) {
    const componentInput = {
      portsByNodeId,
      freeSpaceComponentIds: escapeIndex.freeSpaceComponentIds,
    }
    const startComponents = getAdjacentFreeSpaceComponents({
      ...componentInput,
      nodeIds: [target.capacityMeshNodeId],
    })
    const hasFreeSpaceEscape = destinations.every((nodeIds) => {
      const components = getAdjacentFreeSpaceComponents({
        ...componentInput,
        nodeIds,
      })
      return [...components].some((component) => startComponents.has(component))
    })
    if (hasFreeSpaceEscape) return new Set()
  }
  const destinationNodes = new Set(destinations.flatMap((group) => [...group]))
  const destinationGroupsByNode = new Map<CapacityMeshNodeId, number[]>()
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
  const parentByNodeId = new Map<
    CapacityMeshNodeId,
    { nodeId: CapacityMeshNodeId; port: SegmentPortPoint }
  >()
  const escapePorts = new Set<SegmentPortPoint>()
  const queue = [target.capacityMeshNodeId]
  for (let index = 0; index < queue.length; index++) {
    const nodeId = queue[index]!
    for (const port of portsByNodeId.get(nodeId) ?? []) {
      if (
        (port.cramped && !allowCrampedPortPoints) ||
        (isOrdinaryPortAvailable && !isOrdinaryPortAvailable(port, target))
      )
        continue
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
        if (allowCrampedPortPoints) {
          parentByNodeId.set(neighborId, { nodeId, port })
        }
        for (const group of destinationGroupsByNode.get(neighborId) ?? []) {
          if (reachedGroups.has(group)) continue
          reachedGroups.add(group)
          let parent = parentByNodeId.get(neighborId)
          while (parent) {
            if (parent.port.cramped) escapePorts.add(parent.port)
            parent = parentByNodeId.get(parent.nodeId)
          }
        }
        if (reachedGroups.size === destinations.length) {
          return escapePorts
        }
        queue.push(neighborId)
      }
    }
  }
  return undefined
}
