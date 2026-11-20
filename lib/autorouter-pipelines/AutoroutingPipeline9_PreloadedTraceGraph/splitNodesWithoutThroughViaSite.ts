import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import { createPreloadedCopperIndex } from "./createPreloadedCopperLookup"

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
  const reach = viaRadius + wireClearance

  const isCovered = (node: CapacityMeshNode): boolean => {
    if (
      node.availableZ.length < 2 ||
      node._containsTarget ||
      node._containsObstacle ||
      node._isVirtualOffboard
    )
      return false

    const { x, y } = node.center
    const nearby = copper.search(x - reach, y - reach, x + reach, y + reach)
    if (nearby.length === 0) return false
    const halfWidth = node.width / 2
    const halfHeight = node.height / 2
    const corners = [
      { x: x - halfWidth, y: y - halfHeight },
      { x: x + halfWidth, y: y - halfHeight },
      { x: x - halfWidth, y: y + halfHeight },
      { x: x + halfWidth, y: y + halfHeight },
    ]
    // A segment's clearance envelope is convex. If one foreign piece of copper
    // excludes all four corners, it excludes every possible through-via center.
    return nearby.some(({ route, start, end, radius, kind }): boolean => {
      if (
        kind !== "wire" ||
        !route.isFixed ||
        activeNets.has(route.rootConnectionName ?? route.connectionName)
      ) {
        return false
      }
      return corners.every(
        (corner) =>
          pointToSegmentDistance(corner, start, end) < radius + reach - 1e-9,
      )
    })
  }
  // Preserve an already feasible plan, including all of its shared port positions.
  if (
    !nodes.some(
      (node) =>
        layerChangeNodeIds.has(node.capacityMeshNodeId) && isCovered(node),
    )
  ) {
    return nodes
  }
  return nodes.flatMap((node): CapacityMeshNode[] => {
    if (!isCovered(node)) return [node]
    return node.availableZ.map((z) => ({
      ...node,
      capacityMeshNodeId: `${node.capacityMeshNodeId}_no_via_z${z}`,
      layer: `z${z}`,
      availableZ: [z],
    }))
  })
}
