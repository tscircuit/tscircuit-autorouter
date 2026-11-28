import { getSegmentToObstacleDistance } from "lib/utils/getSegmentToObstacleDistance"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import { createPreloadedCopperIndex } from "./createPreloadedCopperLookup"
import { isRectCoveredByCapsules } from "./isRectCoveredByCapsules"

export function splitNodesWithoutThroughViaSite({
  nodes,
  layerChangeNodeIds,
  srj,
  connMap,
  viaDiameter,
}: {
  nodes: CapacityMeshNode[]
  layerChangeNodeIds: ReadonlySet<string>
  srj: SimpleRouteJson
  connMap: ConnectivityMap
  viaDiameter: number
}): CapacityMeshNode[] {
  if (
    layerChangeNodeIds.size === 0 ||
    srj.allowBlindAndBuriedVias ||
    !srj.traces?.some((trace) => trace.isFixed)
  ) {
    return nodes
  }
  const copper = createPreloadedCopperIndex({ srj, connMap, viaDiameter })
  if (!copper) return nodes
  const activeNets = new Set(
    srj.connections.map(
      ({ name }) => connMap.getNetConnectedToId(name) ?? name,
    ),
  )
  const viaRadius = viaDiameter / 2
  const wireClearance =
    srj.minTraceToPadEdgeClearance ?? srj.defaultObstacleMargin ?? 0
  const viaClearance = srj.minPadEdgeToPadEdgeClearance ?? wireClearance

  const isCovered = (node: CapacityMeshNode): boolean => {
    const reach = viaRadius + Math.max(wireClearance, viaClearance)
    if (
      node.availableZ.length < 2 ||
      node._containsTarget ||
      node._containsObstacle ||
      node._isVirtualOffboard
    )
      return false

    const { x, y } = node.center
    const halfWidth = node.width / 2
    const halfHeight = node.height / 2
    const nearby = copper.search(
      x - halfWidth - reach, y - halfHeight - reach,
      x + halfWidth + reach, y + halfHeight + reach,
    )
    const corners = [
      { x: x - halfWidth, y: y - halfHeight },
      { x: x + halfWidth, y: y - halfHeight },
      { x: x - halfWidth, y: y + halfHeight },
      { x: x + halfWidth, y: y + halfHeight },
    ]
    // A through barrel occupies surface layers even when its logical
    // transition only uses inner layers. Pads on those surfaces still block it.
    if (!srj.allowViaInPad && srj.obstacles.some((obstacle): boolean => {
      const obstacleRadius = Math.hypot(obstacle.width, obstacle.height) / 2
      if (Math.abs(obstacle.center.x - x) > halfWidth + obstacleRadius + reach ||
          Math.abs(obstacle.center.y - y) > halfHeight + obstacleRadius + reach) return false
      const belongsToActiveNet = obstacle.connectedTo.some(id =>
        activeNets.has(connMap.getNetConnectedToId(id) ?? id))
      const padReach = viaRadius + (belongsToActiveNet ? 0 :
        (srj.minViaEdgeToPadEdgeClearance ?? viaClearance))
      return corners.every((corner): boolean =>
        getSegmentToObstacleDistance({ start: corner, end: corner, obstacle }) < padReach - 1e-9,
      )
    })) return true
    const capsules = nearby.filter(({ route }) => route.isFixed &&
      !activeNets.has(route.rootConnectionName ?? route.connectionName))
      .map(({ start, end, radius, kind }) => ({ start, end,
        radius: radius + viaRadius + (kind === "via" ? viaClearance : wireClearance),
      }))
    return isRectCoveredByCapsules({
      minX: x - halfWidth, maxX: x + halfWidth,
      minY: y - halfHeight, maxY: y + halfHeight,
    }, capsules)
  }
  const plannedViaNodes = nodes.filter((node) =>
    layerChangeNodeIds.has(node.capacityMeshNodeId),
  )
  if (!plannedViaNodes.some(isCovered)) {
    return nodes
  }
  const refined = nodes.flatMap((node): CapacityMeshNode[] => {
    if (!isCovered(node)) return [node]
    return node.availableZ.map((z) => ({
      ...node,
      capacityMeshNodeId: `${node.capacityMeshNodeId}_no_via_z${z}`,
      layer: `z${z}`,
      availableZ: [z],
    }))
  })
  return refined.length === nodes.length ? nodes : refined
}
