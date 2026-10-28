import { pointToBoxDistance } from "@tscircuit/math-utils"
import { getConnectionPointZLayers } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/get-connection-point-z-layers"
import type { CapacityMeshNode, SimpleRouteConnection } from "lib/types"

type LayerRegionGroup = {
  keptNodeId: string
  removedNodeIds: string[]
  availableZ: number[]
}
type LayerRegionCoalescence = {
  nodes: CapacityMeshNode[]
  groups: LayerRegionGroup[]
  removedNodeCount: number
}
type IndexedNode = { node: CapacityMeshNode; index: number }
const CORE_KEYS = new Set([
  "capacityMeshNodeId", "center", "width", "height", "layer", "availableZ",
])
const COMPATIBLE_KEYS = new Set([
  "_isComponentTopologyNode", "_containsObstacle", "_completelyInsideObstacle",
  "_containsTarget", "_targetConnectionName", "_connectedTo", "_qfpRegionType",
  "_isNarrowQfpPadGap", "_soicRegionType", "layerChangeAllowedNetIds",
])

const getFreeRegionKey = (node: CapacityMeshNode): string | undefined => {
  if (!node._isComponentTopologyNode || node._containsObstacle ||
    node._completelyInsideObstacle || node._containsTarget ||
    node._targetConnectionName !== undefined || (node._connectedTo?.length ?? 0) > 0) return
  const metadata: Record<string, unknown> = {}
  for (const key of Object.keys(node).sort()) {
    if (CORE_KEYS.has(key)) continue
    const value = (node as unknown as Record<string, unknown>)[key]
    if (value === undefined) continue
    if (!COMPATIBLE_KEYS.has(key)) return
    metadata[key] = value
  }
  return JSON.stringify([node.center.x, node.center.y, node.width, node.height, metadata])
}

const hasPositiveSharedLayerOverlap = (
  node: CapacityMeshNode,
  other: CapacityMeshNode,
  availableZ: ReadonlySet<number>,
): boolean => {
  if (!other.availableZ.some((z) => availableZ.has(z))) return false
  const overlapX = Math.min(node.center.x + node.width / 2, other.center.x + other.width / 2) -
    Math.max(node.center.x - node.width / 2, other.center.x - other.width / 2)
  const overlapY = Math.min(node.center.y + node.height / 2, other.center.y + other.height / 2) -
    Math.max(node.center.y - node.height / 2, other.center.y - other.height / 2)
  return overlapX > 0 && overlapY > 0
}

/** Join existing identical free XY cells, without adding any layer or physical routing area.
 * Call before edges/ports are generated. Original electrical endpoint regions are
 * excluded even when their target metadata has not yet been assigned. Pass all
 * original and transformed routing demands in terminalConnections.
 * Via feasibility is a separate constraint and must still be applied to the graph.
 */
export const coalescePipeline9LayerRegions = ({
  nodes,
  layerCount,
  terminalConnections,
}: {
  nodes: readonly CapacityMeshNode[]
  layerCount: number
  terminalConnections: readonly SimpleRouteConnection[]
}): LayerRegionCoalescence => {
  if (!Number.isSafeInteger(layerCount) || layerCount < 1) {
    throw new Error("Layer-region coalescence requires the original board layer count")
  }
  const ids = new Set<string>(), candidates = new Map<string, IndexedNode[]>()
  const referencedNodeIds = new Set(nodes.flatMap((node) => [
    ...(node._adjacentNodeIds ?? []), ...(node._offBoardConnectedCapacityMeshNodeIds ?? []),
    ...(node._strawParentCapacityMeshNodeId === undefined ? [] : [node._strawParentCapacityMeshNodeId]),
    ...(node._parent === undefined ? [] : [node._parent.capacityMeshNodeId]),
  ]))
  nodes.forEach((node, index) => {
    if (ids.has(node.capacityMeshNodeId)) throw new Error(`Duplicate capacity region ${node.capacityMeshNodeId}`)
    ids.add(node.capacityMeshNodeId)
    const minX = node.center.x - node.width / 2, maxX = node.center.x + node.width / 2
    const minY = node.center.y - node.height / 2, maxY = node.center.y + node.height / 2
    if (![node.center.x, node.center.y, node.width, node.height, minX, minY, maxX, maxY].every(Number.isFinite) ||
      minX >= maxX || minY >= maxY ||
      node.width <= 0 || node.height <= 0 || node.availableZ.length === 0 ||
      new Set(node.availableZ).size !== node.availableZ.length || node.availableZ.some((z) =>
        !Number.isSafeInteger(z) || z < 0 || z >= layerCount)) {
      throw new Error(`Invalid capacity region ${node.capacityMeshNodeId}`)
    }
    const key = getFreeRegionKey(node)
    if (key === undefined) return
    const group = candidates.get(key) ?? []
    group.push({ node, index })
    candidates.set(key, group)
  })
  const terminals = terminalConnections.flatMap((connection) =>
    connection.pointsToConnect.map((point) => ({ point,
      layers: getConnectionPointZLayers({ point, layerCount: layerCount }) })))
  const replacements = new Map<number, CapacityMeshNode>(), removed = new Set<number>()
  const groups: LayerRegionGroup[] = []
  for (const group of candidates.values()) {
    if (group.length < 2 || group.some(({ node }) => referencedNodeIds.has(node.capacityMeshNodeId))) continue
    const first = group[0]!, layers = group.flatMap(({ node }) => node.availableZ)
    const layerSet = new Set(layers)
    if (layerSet.size !== layers.length) continue
    // Match the existing endpoint-region selector's 0.001 mm tolerance.
    if (terminals.some(({ point, layers }) =>
      layers.some((z) => layerSet.has(z)) && pointToBoxDistance(point, first.node) <= 0.001)) continue
    const indexes = new Set(group.map(({ index }) => index))
    if (nodes.some((other, index) => !indexes.has(index) &&
      hasPositiveSharedLayerOverlap(first.node, other, layerSet))) continue
    const availableZ = [...layerSet].sort((a, b) => a - b)
    replacements.set(first.index, { ...first.node, availableZ,
      layer: `z${availableZ.join(",")}` })
    const removedNodeIds: string[] = []
    for (const member of group.slice(1)) {
      removed.add(member.index)
      removedNodeIds.push(member.node.capacityMeshNodeId)
    }
    groups.push({ keptNodeId: first.node.capacityMeshNodeId, removedNodeIds, availableZ })
  }
  return { nodes: nodes.flatMap((node, index) => removed.has(index) ? [] :
    [replacements.get(index) ?? node]), groups, removedNodeCount: removed.size }
}
