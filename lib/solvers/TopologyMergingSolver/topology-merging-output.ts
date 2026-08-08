import type { Bounds } from "@tscircuit/math-utils"
import type { CapacityMeshNode } from "lib/types"
import {
  getBoundsIntersection,
  getCapacityMeshNodeBounds,
  isValidCapacityBounds,
} from "../TopologyPlanningSolver/capacity-node-geometry"
import type {
  PreparedTopologyMergingNode,
  TopologyMergingNodeGroup,
  TopologyMergingRegion,
  TopologyMergingRegionMetadata,
} from "./topology-merging-types"
import {
  TOPOLOGY_MERGING_EPSILON,
  TOPOLOGY_PROVENANCE_EPSILON,
} from "./topology-merging-types"

export type TopologyMergingOutputProvenance = {
  groupIndexesByNodeId: Map<string, number[]>
  sourceKeysByNodeId: Map<string, string[]>
}

export function createTopologyMergingOutputNodes({
  regions,
  preparedNodeBySourceKey,
  nodeGroups,
  provenance,
  preserveSourceIds = true,
}: {
  regions: TopologyMergingRegion[]
  preparedNodeBySourceKey: ReadonlyMap<string, PreparedTopologyMergingNode>
  nodeGroups: readonly TopologyMergingNodeGroup[]
  provenance: TopologyMergingOutputProvenance
  preserveSourceIds?: boolean
}): CapacityMeshNode[] {
  if (preserveSourceIds) {
    provenance.groupIndexesByNodeId.clear()
    provenance.sourceKeysByNodeId.clear()
  }
  const sortedRegions = [...regions].sort(
    (a, b) =>
      a.bounds.minX - b.bounds.minX ||
      a.bounds.minY - b.bounds.minY ||
      a.bounds.maxX - b.bounds.maxX ||
      a.bounds.maxY - b.bounds.maxY ||
      a.availableZ[0]! - b.availableZ[0]!,
  )
  const usedNodeIds = new Set<string>()

  return sortedRegions.map((region, regionIndex) => {
    const sourcePreparedNodes = region.sourceKeys.map((sourceKey) => {
      const preparedNode = preparedNodeBySourceKey.get(sourceKey)
      if (!preparedNode) {
        throw new Error(
          `TopologyMergingSolver: missing source node for "${sourceKey}"`,
        )
      }
      return preparedNode
    })
    const sourceNodes = sourcePreparedNodes.map(({ node }) => node)
    const isComponentTopologyNode = sourcePreparedNodes.some(
      ({ groupIndex }) => nodeGroups[groupIndex]!.isComponent,
    )
    const metadata = getOutputNodeMetadata({
      sourceNodes,
      isComponentTopologyNode,
    })
    const preservedSourceNode =
      preserveSourceIds && sourcePreparedNodes.length === 1
        ? sourcePreparedNodes[0]!.node
        : null
    const canPreserveSourceId = Boolean(
      preservedSourceNode &&
        canPreserveSourceNodeId({
          region,
          sourceNode: preservedSourceNode,
          usedNodeIds,
        }),
    )
    let capacityMeshNodeId = canPreserveSourceId
      ? preservedSourceNode!.capacityMeshNodeId
      : `topology_merge_${regionIndex}`
    while (usedNodeIds.has(capacityMeshNodeId)) {
      capacityMeshNodeId = `${capacityMeshNodeId}_next`
    }
    usedNodeIds.add(capacityMeshNodeId)

    if (preserveSourceIds) {
      provenance.groupIndexesByNodeId.set(capacityMeshNodeId, [
        ...new Set(sourcePreparedNodes.map(({ groupIndex }) => groupIndex)),
      ])
      provenance.sourceKeysByNodeId.set(capacityMeshNodeId, [
        ...region.sourceKeys,
      ])
    }

    return {
      ...(preservedSourceNode ?? sourceNodes[0]),
      ...metadata,
      capacityMeshNodeId,
      center: {
        x: (region.bounds.minX + region.bounds.maxX) / 2,
        y: (region.bounds.minY + region.bounds.maxY) / 2,
      },
      width: region.bounds.maxX - region.bounds.minX,
      height: region.bounds.maxY - region.bounds.minY,
      layer: `z${region.availableZ.join(",")}`,
      availableZ: [...region.availableZ],
      _adjacentNodeIds: undefined,
      _parent: undefined,
      _strawNode: undefined,
      _strawParentCapacityMeshNodeId: undefined,
    }
  })
}

export function validateTopologyMergingOutput({
  nodes,
  preparedNodeBySourceKey,
  provenance,
}: {
  nodes: CapacityMeshNode[]
  preparedNodeBySourceKey: ReadonlyMap<string, PreparedTopologyMergingNode>
  provenance: TopologyMergingOutputProvenance
}): void {
  const nodeIds = new Set<string>()
  for (const node of nodes) {
    if (nodeIds.has(node.capacityMeshNodeId)) {
      throw new Error(
        `TopologyMergingSolver: duplicate output node id "${node.capacityMeshNodeId}"`,
      )
    }
    nodeIds.add(node.capacityMeshNodeId)

    if (!isValidCapacityBounds(getCapacityMeshNodeBounds(node))) {
      throw new Error(
        `TopologyMergingSolver: output node "${node.capacityMeshNodeId}" has invalid bounds`,
      )
    }
    if (node.availableZ.length === 0) {
      throw new Error(
        `TopologyMergingSolver: output node "${node.capacityMeshNodeId}" has no available layers`,
      )
    }

    const sourceKeys = provenance.sourceKeysByNodeId.get(
      node.capacityMeshNodeId,
    )
    if (!sourceKeys) {
      throw new Error(
        `TopologyMergingSolver: missing output provenance for node "${node.capacityMeshNodeId}"`,
      )
    }
    if (sourceKeys.length === 1) {
      validateSingleSourceOutput({
        node,
        sourceKey: sourceKeys[0]!,
        preparedNodeBySourceKey,
      })
    }
  }

  for (let aIndex = 0; aIndex < nodes.length; aIndex++) {
    const nodeA = nodes[aIndex]!
    for (let bIndex = aIndex + 1; bIndex < nodes.length; bIndex++) {
      const nodeB = nodes[bIndex]!
      const sharedLayers = nodeA.availableZ.filter((z) =>
        nodeB.availableZ.includes(z),
      )
      if (sharedLayers.length === 0) continue

      const intersection = getBoundsIntersection(
        getCapacityMeshNodeBounds(nodeA),
        getCapacityMeshNodeBounds(nodeB),
      )
      if (!intersection) continue
      const intersectionWidth = intersection.maxX - intersection.minX
      const intersectionHeight = intersection.maxY - intersection.minY
      if (
        intersectionWidth <= TOPOLOGY_PROVENANCE_EPSILON ||
        intersectionHeight <= TOPOLOGY_PROVENANCE_EPSILON
      ) {
        continue
      }

      const nodeAGroupIndexes = provenance.groupIndexesByNodeId.get(
        nodeA.capacityMeshNodeId,
      )
      const nodeBGroupIndexes = provenance.groupIndexesByNodeId.get(
        nodeB.capacityMeshNodeId,
      )
      if (!nodeAGroupIndexes || !nodeBGroupIndexes) {
        throw new Error(
          `TopologyMergingSolver: missing output provenance for overlapping nodes "${nodeA.capacityMeshNodeId}" and "${nodeB.capacityMeshNodeId}"`,
        )
      }
      const nodeASourceKeys = provenance.sourceKeysByNodeId.get(
        nodeA.capacityMeshNodeId,
      )
      const nodeBSourceKeys = provenance.sourceKeysByNodeId.get(
        nodeB.capacityMeshNodeId,
      )
      if (!nodeASourceKeys || !nodeBSourceKeys) {
        throw new Error(
          `TopologyMergingSolver: missing source provenance for overlapping nodes "${nodeA.capacityMeshNodeId}" and "${nodeB.capacityMeshNodeId}"`,
        )
      }
      if (
        isPreservedSameGroupOverlap({
          groupIndexesA: nodeAGroupIndexes,
          groupIndexesB: nodeBGroupIndexes,
          sourceKeysA: nodeASourceKeys,
          sourceKeysB: nodeBSourceKeys,
          sharedLayers,
          preparedNodeBySourceKey,
        })
      ) {
        continue
      }

      throw new Error(
        `TopologyMergingSolver: output nodes "${nodeA.capacityMeshNodeId}" and "${nodeB.capacityMeshNodeId}" have an unresolved inter-group overlap on a shared layer`,
      )
    }
  }
}

function getOutputNodeMetadata({
  sourceNodes,
  isComponentTopologyNode,
}: {
  sourceNodes: CapacityMeshNode[]
  isComponentTopologyNode: boolean
}): TopologyMergingRegionMetadata {
  if (sourceNodes.length === 1) {
    return {
      _isComponentTopologyNode: isComponentTopologyNode
        ? true
        : sourceNodes[0]!._isComponentTopologyNode,
      _skipEndpointNetReservation: isComponentTopologyNode
        ? undefined
        : sourceNodes[0]!._skipEndpointNetReservation,
      _isApproximateTerminalRefinement:
        sourceNodes[0]!._isApproximateTerminalRefinement,
      _obstacleOccupancyFraction: isComponentTopologyNode
        ? undefined
        : sourceNodes[0]!._obstacleOccupancyFraction,
    }
  }

  const sourceNodeIds = sourceNodes.map((node) => node.capacityMeshNodeId)
  const targetConnectionName = getUniqueOptionalValue(
    sourceNodes.map((node) => node._targetConnectionName),
    "target connection",
    sourceNodeIds,
  )
  const offBoardConnectionId = getUniqueOptionalValue(
    sourceNodes.map((node) => node._offBoardConnectionId),
    "off-board connection",
    sourceNodeIds,
  )
  const offboardNetName = getUniqueOptionalValue(
    sourceNodes.map((node) => node._offboardNetName),
    "off-board net",
    sourceNodeIds,
  )
  const offBoardConnectedCapacityMeshNodeIds = Array.from(
    new Set(
      sourceNodes.flatMap(
        (node) => node._offBoardConnectedCapacityMeshNodeIds ?? [],
      ),
    ),
  )
  const connectedTo = Array.from(
    new Set(sourceNodes.flatMap((node) => node._connectedTo ?? [])),
  )

  return {
    _containsObstacle:
      sourceNodes.some((node) => node._containsObstacle) || undefined,
    _completelyInsideObstacle:
      sourceNodes.some((node) => node._completelyInsideObstacle) || undefined,
    _containsTarget:
      sourceNodes.some((node) => node._containsTarget) || undefined,
    _targetConnectionName: targetConnectionName,
    _isVirtualOffboard:
      sourceNodes.some((node) => node._isVirtualOffboard) || undefined,
    _offboardNetName: offboardNetName,
    _offBoardConnectionId: offBoardConnectionId,
    _offBoardConnectedCapacityMeshNodeIds:
      offBoardConnectedCapacityMeshNodeIds.length > 0
        ? offBoardConnectedCapacityMeshNodeIds
        : undefined,
    _qfpRegionType: getAgreedOptionalValue(
      sourceNodes.map((node) => node._qfpRegionType),
    ),
    _isNarrowQfpPadGap:
      sourceNodes.some((node) => node._isNarrowQfpPadGap) || undefined,
    _soicRegionType: getAgreedOptionalValue(
      sourceNodes.map((node) => node._soicRegionType),
    ),
    _isComponentTopologyNode: isComponentTopologyNode || undefined,
    _connectedTo: connectedTo.length > 0 ? connectedTo : undefined,
    _skipEndpointNetReservation:
      !isComponentTopologyNode &&
      sourceNodes.every((node) => node._skipEndpointNetReservation)
        ? true
        : undefined,
    _isApproximateTerminalRefinement:
      sourceNodes.some((node) => node._isApproximateTerminalRefinement) ||
      undefined,
    _obstacleOccupancyFraction: isComponentTopologyNode
      ? undefined
      : Math.max(
          0,
          ...sourceNodes.map(
            (node) => node._obstacleOccupancyFraction ?? 0,
          ),
        ),
  }
}

function canPreserveSourceNodeId({
  region,
  sourceNode,
  usedNodeIds,
}: {
  region: TopologyMergingRegion
  sourceNode: CapacityMeshNode
  usedNodeIds: ReadonlySet<string>
}): boolean {
  const sourceBounds = getCapacityMeshNodeBounds(sourceNode)
  const hasSameBounds =
    Math.abs(region.bounds.minX - sourceBounds.minX) <=
      TOPOLOGY_MERGING_EPSILON &&
    Math.abs(region.bounds.maxX - sourceBounds.maxX) <=
      TOPOLOGY_MERGING_EPSILON &&
    Math.abs(region.bounds.minY - sourceBounds.minY) <=
      TOPOLOGY_MERGING_EPSILON &&
    Math.abs(region.bounds.maxY - sourceBounds.maxY) <= TOPOLOGY_MERGING_EPSILON
  const hasSameAvailableZ =
    region.availableZ.length === sourceNode.availableZ.length &&
    region.availableZ.every((z, index) => z === sourceNode.availableZ[index])

  return (
    hasSameBounds &&
    hasSameAvailableZ &&
    !usedNodeIds.has(sourceNode.capacityMeshNodeId)
  )
}

function getUniqueOptionalValue<T>(
  values: Array<T | undefined>,
  fieldName: string,
  sourceNodeIds: string[],
): T | undefined {
  const definedValues = Array.from(
    new Set(values.filter((value): value is T => value !== undefined)),
  )

  if (definedValues.length > 1) {
    throw new Error(
      `TopologyMergingSolver: conflicting ${fieldName} values for overlapping source nodes ${sourceNodeIds.join(", ")}`,
    )
  }

  return definedValues[0]
}

function getAgreedOptionalValue<T>(
  values: Array<T | undefined>,
): T | undefined {
  const definedValues = Array.from(
    new Set(values.filter((value): value is T => value !== undefined)),
  )

  return definedValues.length === 1 ? definedValues[0] : undefined
}

function validateSingleSourceOutput({
  node,
  sourceKey,
  preparedNodeBySourceKey,
}: {
  node: CapacityMeshNode
  sourceKey: string
  preparedNodeBySourceKey: ReadonlyMap<string, PreparedTopologyMergingNode>
}): void {
  const preparedNode = preparedNodeBySourceKey.get(sourceKey)
  if (!preparedNode) {
    throw new Error(
      `TopologyMergingSolver: missing source node for output "${node.capacityMeshNodeId}"`,
    )
  }

  const bounds = getCapacityMeshNodeBounds(node)
  const isInsideSource =
    bounds.minX >= preparedNode.bounds.minX - TOPOLOGY_PROVENANCE_EPSILON &&
    bounds.maxX <= preparedNode.bounds.maxX + TOPOLOGY_PROVENANCE_EPSILON &&
    bounds.minY >= preparedNode.bounds.minY - TOPOLOGY_PROVENANCE_EPSILON &&
    bounds.maxY <= preparedNode.bounds.maxY + TOPOLOGY_PROVENANCE_EPSILON
  const usesOnlySourceLayers = node.availableZ.every((z) =>
    preparedNode.node.availableZ.includes(z),
  )
  if (!isInsideSource || !usesOnlySourceLayers) {
    throw new Error(
      `TopologyMergingSolver: output node "${node.capacityMeshNodeId}" escapes its source geometry or layers`,
    )
  }
}

function isPreservedSameGroupOverlap({
  groupIndexesA,
  groupIndexesB,
  sourceKeysA,
  sourceKeysB,
  sharedLayers,
  preparedNodeBySourceKey,
}: {
  groupIndexesA: number[]
  groupIndexesB: number[]
  sourceKeysA: string[]
  sourceKeysB: string[]
  sharedLayers: number[]
  preparedNodeBySourceKey: ReadonlyMap<string, PreparedTopologyMergingNode>
}): boolean {
  if (
    groupIndexesA.length !== 1 ||
    groupIndexesB.length !== 1 ||
    groupIndexesA[0] !== groupIndexesB[0] ||
    sourceKeysA.length !== 1 ||
    sourceKeysB.length !== 1 ||
    sourceKeysA[0] === sourceKeysB[0]
  ) {
    return false
  }

  const sourceA = preparedNodeBySourceKey.get(sourceKeysA[0]!)
  const sourceB = preparedNodeBySourceKey.get(sourceKeysB[0]!)
  if (!sourceA || !sourceB || sharedLayers.length === 0) return false

  const sourcesShareLayer = sharedLayers.some(
    (z) =>
      sourceA.node.availableZ.includes(z) &&
      sourceB.node.availableZ.includes(z),
  )
  return (
    sourcesShareLayer &&
    getBoundsIntersection(sourceA.bounds, sourceB.bounds) !== null
  )
}
