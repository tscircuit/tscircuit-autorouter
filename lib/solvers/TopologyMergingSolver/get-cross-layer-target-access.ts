import type { Bounds } from "@tscircuit/math-utils"
import type { CapacityMeshNode } from "lib/types"
import {
  getBoundsIntersection,
  getCapacityMeshNodeBounds,
} from "../TopologyPlanningSolver/capacity-node-geometry"
import {
  compactTopologyMergingRegions,
  doesBoundsContainPoint,
  getCanonicalCoordinates,
} from "./topology-merging-regions"
import type {
  TopologyMergingNodeGroup,
  TopologyMergingRegion,
} from "./topology-merging-types"

type CrossLayerAccessOverlap = {
  bounds: Bounds
  availableZ: number[]
}

const getConnectionAliases = (node: CapacityMeshNode): string[] => [
  ...(node._targetConnectionName ? [node._targetConnectionName] : []),
  ...(node._connectedTo ?? []),
]

function shareConnectionAlias(
  firstNode: CapacityMeshNode,
  secondNode: CapacityMeshNode,
): boolean {
  const firstAliases = new Set(getConnectionAliases(firstNode))
  return getConnectionAliases(secondNode).some((alias) =>
    firstAliases.has(alias),
  )
}

function getCrossLayerAccessOverlap(
  targetNode: CapacityMeshNode,
  accessNode: CapacityMeshNode,
): Bounds | null {
  const addsLayer = accessNode.availableZ.some(
    (z) => !targetNode.availableZ.includes(z),
  )
  if (!addsLayer) return null

  return getBoundsIntersection(
    getCapacityMeshNodeBounds(targetNode),
    getCapacityMeshNodeBounds(accessNode),
  )
}

function getReachableLayers({
  targetLayers,
  accessLayers,
}: {
  targetLayers: number[]
  accessLayers: number[]
}): number[] {
  const accessibleLayers = new Set([...targetLayers, ...accessLayers])
  const reachableLayers = new Set(targetLayers)

  while (true) {
    const previousSize = reachableLayers.size
    for (const z of accessibleLayers) {
      if (reachableLayers.has(z - 1) || reachableLayers.has(z + 1)) {
        reachableLayers.add(z)
      }
    }
    if (reachableLayers.size === previousSize) break
  }

  return [...reachableLayers].sort((a, b) => a - b)
}

function createTargetAccessRegion(
  bounds: Bounds,
  availableZ: number[],
): TopologyMergingRegion {
  return {
    bounds,
    availableZ,
    sourceKeys: [],
    topologyMode: "target-passthrough",
    topologySignature: `cross-layer-target:${availableZ.join(",")}`,
  }
}

function getViaCapableAccessArea({
  regions,
  targetLayers,
  viaDiameter,
}: {
  regions: TopologyMergingRegion[]
  targetLayers: number[]
  viaDiameter: number
}): number {
  return regions.reduce((area, region) => {
    const addsLayer = region.availableZ.some(
      (z) => !targetLayers.includes(z),
    )
    const width = region.bounds.maxX - region.bounds.minX
    const height = region.bounds.maxY - region.bounds.minY
    return addsLayer && Math.min(width, height) >= viaDiameter
      ? area + width * height
      : area
  }, 0)
}

function getAlignedTargetAccessRegions({
  targetBounds,
  freeAccessOverlaps,
  sameNetTargetBounds,
  blockerBounds,
  targetLayers,
  targetConnectionLayers,
  viaDiameter,
}: {
  targetBounds: Bounds
  freeAccessOverlaps: CrossLayerAccessOverlap[]
  sameNetTargetBounds: Bounds[]
  blockerBounds: Bounds[]
  targetLayers: number[]
  targetConnectionLayers: ReadonlySet<number>
  viaDiameter: number
}): TopologyMergingRegion[] {
  const xCoordinates = getCanonicalCoordinates([
    targetBounds.minX,
    targetBounds.maxX,
    ...freeAccessOverlaps.flatMap(({ bounds }) => [
      bounds.minX,
      bounds.maxX,
    ]),
    ...sameNetTargetBounds.flatMap((bounds) => [bounds.minX, bounds.maxX]),
    ...blockerBounds.flatMap((bounds) => [bounds.minX, bounds.maxX]),
  ])
  const yCoordinates = getCanonicalCoordinates([
    targetBounds.minY,
    targetBounds.maxY,
    ...freeAccessOverlaps.flatMap(({ bounds }) => [
      bounds.minY,
      bounds.maxY,
    ]),
    ...sameNetTargetBounds.flatMap((bounds) => [bounds.minY, bounds.maxY]),
    ...blockerBounds.flatMap((bounds) => [bounds.minY, bounds.maxY]),
  ])
  const regions: TopologyMergingRegion[] = []

  for (let xIndex = 0; xIndex < xCoordinates.length - 1; xIndex++) {
    for (let yIndex = 0; yIndex < yCoordinates.length - 1; yIndex++) {
      const bounds = {
        minX: xCoordinates[xIndex]!,
        maxX: xCoordinates[xIndex + 1]!,
        minY: yCoordinates[yIndex]!,
        maxY: yCoordinates[yIndex + 1]!,
      }
      const center = {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
      }
      const isBlocked = blockerBounds.some((blocker) =>
        doesBoundsContainPoint(blocker, center),
      )
      const isOtherLayerTarget = sameNetTargetBounds.some((otherTarget) =>
        doesBoundsContainPoint(otherTarget, center),
      )
      const accessLayers = freeAccessOverlaps.flatMap((candidate) =>
        doesBoundsContainPoint(candidate.bounds, center)
          ? candidate.availableZ
          : [],
      )
      const reachableZ =
        isBlocked || isOtherLayerTarget
          ? targetLayers
          : getReachableLayers({ targetLayers, accessLayers })
      const targetAccessZ = reachableZ.filter((z) =>
        targetConnectionLayers.has(z),
      )
      const availableZ = targetAccessZ.some(
        (z) => !targetLayers.includes(z),
      )
        ? targetAccessZ
        : targetLayers
      regions.push(createTargetAccessRegion(bounds, availableZ))
    }
  }

  // The same free cells can form either short rows or a via-sized column.
  // Keep the rectangular decomposition with more physically usable access.
  const horizontalFirstRegions = compactTopologyMergingRegions(
    regions,
    "horizontal",
  )
  const verticalFirstRegions = compactTopologyMergingRegions(
    regions,
    "vertical",
  )
  const horizontalAccessArea = getViaCapableAccessArea({
    regions: horizontalFirstRegions,
    targetLayers,
    viaDiameter,
  })
  const verticalAccessArea = getViaCapableAccessArea({
    regions: verticalFirstRegions,
    targetLayers,
    viaDiameter,
  })
  const alignedRegions =
    verticalAccessArea > horizontalAccessArea
      ? verticalFirstRegions
      : horizontalFirstRegions
  const compactedRegions = alignedRegions.map(
    (region) => {
      const addsLayer = region.availableZ.some(
        (z) => !targetLayers.includes(z),
      )
      const width = region.bounds.maxX - region.bounds.minX
      const height = region.bounds.maxY - region.bounds.minY
      return addsLayer && Math.min(width, height) < viaDiameter
        ? createTargetAccessRegion(region.bounds, targetLayers)
        : region
    },
  )

  return compactTopologyMergingRegions(compactedRegions)
}

function addCrossLayerAccessToTarget({
  node,
  crossLayerAccessNodes,
  blockerNodes,
  viaDiameter,
}: {
  node: CapacityMeshNode
  crossLayerAccessNodes: readonly CapacityMeshNode[]
  blockerNodes: readonly CapacityMeshNode[]
  viaDiameter: number | undefined
}): CapacityMeshNode[] {
  if (
    viaDiameter === undefined ||
    !node._containsTarget ||
    !node._containsObstacle ||
    Math.min(node.width, node.height) < viaDiameter
  ) {
    return [node]
  }

  const crossLayerSameNetTargets = crossLayerAccessNodes.filter(
    (candidate) =>
      candidate._containsTarget &&
      candidate._containsObstacle &&
      shareConnectionAlias(node, candidate) &&
      getCrossLayerAccessOverlap(node, candidate) !== null,
  )
  if (crossLayerSameNetTargets.length === 0) return [node]

  const freeAccessOverlaps = crossLayerAccessNodes.flatMap(
    (candidate) => {
      if (candidate === node) return []
      const isFree = !candidate._containsObstacle
      if (!isFree) return []

      const bounds = getCrossLayerAccessOverlap(node, candidate)
      return bounds ? [{ bounds, availableZ: [...candidate.availableZ] }] : []
    },
  )
  if (freeAccessOverlaps.length === 0) return [node]

  const nodeBounds = getCapacityMeshNodeBounds(node)
  const blockerBounds = blockerNodes.flatMap((candidate) => {
    if (
      candidate === node ||
      !candidate._containsObstacle ||
      shareConnectionAlias(node, candidate)
    ) {
      return []
    }
    const intersection = getBoundsIntersection(
      nodeBounds,
      getCapacityMeshNodeBounds(candidate),
    )
    return intersection ? [intersection] : []
  })
  // Free component layers prove that a via can pass through the footprint;
  // only layers with a same-net target become target-owned routing capacity.
  const targetConnectionLayers = new Set([
    ...node.availableZ,
    ...crossLayerSameNetTargets.flatMap((target) => target.availableZ),
  ])
  const sameNetTargetBounds = crossLayerSameNetTargets.flatMap((target) => {
    const intersection = getCrossLayerAccessOverlap(node, target)
    return intersection ? [intersection] : []
  })
  const regions = getAlignedTargetAccessRegions({
    targetBounds: nodeBounds,
    freeAccessOverlaps,
    sameNetTargetBounds,
    blockerBounds,
    targetLayers: node.availableZ,
    targetConnectionLayers,
    viaDiameter,
  })
  const alignedNodes = regions.map((region, index) => {
    const { bounds, availableZ } = region
    return {
      ...node,
      capacityMeshNodeId: `${node.capacityMeshNodeId}:cross-layer-region:${index}`,
      center: {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
      },
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
      availableZ,
      layer: `z${availableZ.join(",")}`,
    }
  })

  return alignedNodes.some(
    ({ availableZ }) => availableZ.length > node.availableZ.length,
  )
    ? alignedNodes
    : [node]
}

/**
 * A component topology can split otherwise-clear layers beneath a global
 * target. When a same-net component target exists on another layer, align the
 * component's free and same-net regions with the global target and expose only
 * contiguous, via-sized, unblocked layer access.
 */
export function getTopologyMergingNodesWithCrossLayerTargetAccess({
  nodeGroups,
  viaDiameter,
}: {
  nodeGroups: readonly TopologyMergingNodeGroup[]
  viaDiameter: number | undefined
}): Map<CapacityMeshNode, CapacityMeshNode[]> {
  const allNodes = nodeGroups.flatMap((group) => group.nodes)
  const componentNodes = nodeGroups
    .filter((group) => group.isComponent)
    .flatMap((group) => group.nodes)
  return new Map(
    nodeGroups.flatMap((group) =>
      group.nodes.map(
        (node) =>
          [
            node,
            // The global target remains authoritative; component nodes prove
            // which additional layers are physically reachable inside its bounds.
            group.isComponent
              ? [node]
              : addCrossLayerAccessToTarget({
                  node,
                  crossLayerAccessNodes: componentNodes,
                  blockerNodes: allNodes,
                  viaDiameter,
                }),
          ] as const,
      ),
    ),
  )
}
