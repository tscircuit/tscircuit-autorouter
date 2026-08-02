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
  isTarget: boolean
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

function getUniformCrossLayerAccess({
  targetBounds,
  crossLayerAccessOverlaps,
  blockerBounds,
  targetLayers,
}: {
  targetBounds: Bounds
  crossLayerAccessOverlaps: CrossLayerAccessOverlap[]
  blockerBounds: Bounds[]
  targetLayers: number[]
}): number[] | null {
  const xCoordinates = getCanonicalCoordinates([
    targetBounds.minX,
    targetBounds.maxX,
    ...crossLayerAccessOverlaps.flatMap(({ bounds }) => [
      bounds.minX,
      bounds.maxX,
    ]),
    ...blockerBounds.flatMap((bounds) => [bounds.minX, bounds.maxX]),
  ])
  const yCoordinates = getCanonicalCoordinates([
    targetBounds.minY,
    targetBounds.maxY,
    ...crossLayerAccessOverlaps.flatMap(({ bounds }) => [
      bounds.minY,
      bounds.maxY,
    ]),
    ...blockerBounds.flatMap((bounds) => [bounds.minY, bounds.maxY]),
  ])
  let uniformAvailableZ: number[] | undefined

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
      if (isBlocked) return null

      const accessLayers = crossLayerAccessOverlaps.flatMap((candidate) =>
        doesBoundsContainPoint(candidate.bounds, center)
          ? candidate.availableZ
          : [],
      )
      const availableZ = getReachableLayers({ targetLayers, accessLayers })
      if (!availableZ.some((z) => !targetLayers.includes(z))) return null
      if (
        uniformAvailableZ &&
        uniformAvailableZ.join(",") !== availableZ.join(",")
      ) {
        return null
      }
      uniformAvailableZ = availableZ
    }
  }

  return uniformAvailableZ ?? null
}

function createAccessRegion(
  bounds: Bounds,
  availableZ: number[],
): TopologyMergingRegion {
  const topologySignature = `cross-layer-target:${availableZ.join(",")}`
  return {
    bounds,
    availableZ,
    sourceKeys: [],
    topologyMode: "target-passthrough",
    topologySignature,
  }
}

function getAlignedCrossLayerAccessRegions({
  targetBounds,
  crossLayerAccessOverlaps,
  blockerBounds,
  targetLayers,
  targetConnectionLayers,
  viaDiameter,
}: {
  targetBounds: Bounds
  crossLayerAccessOverlaps: CrossLayerAccessOverlap[]
  blockerBounds: Bounds[]
  targetLayers: number[]
  targetConnectionLayers: ReadonlySet<number>
  viaDiameter: number
}): TopologyMergingRegion[] {
  const xCoordinates = getCanonicalCoordinates([
    targetBounds.minX,
    targetBounds.maxX,
    ...crossLayerAccessOverlaps.flatMap(({ bounds }) => [
      bounds.minX,
      bounds.maxX,
    ]),
    ...blockerBounds.flatMap((bounds) => [bounds.minX, bounds.maxX]),
  ])
  const yCoordinates = getCanonicalCoordinates([
    targetBounds.minY,
    targetBounds.maxY,
    ...crossLayerAccessOverlaps.flatMap(({ bounds }) => [
      bounds.minY,
      bounds.maxY,
    ]),
    ...blockerBounds.flatMap((bounds) => [bounds.minY, bounds.maxY]),
  ])
  const atomicRegions: TopologyMergingRegion[] = []

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
      const accessLayers = crossLayerAccessOverlaps.flatMap((candidate) =>
        !candidate.isTarget &&
        doesBoundsContainPoint(candidate.bounds, center)
          ? candidate.availableZ
          : [],
      )
      const reachableZ = isBlocked
        ? targetLayers
        : getReachableLayers({ targetLayers, accessLayers })
      const availableZ = reachableZ.filter((z) =>
        targetConnectionLayers.has(z),
      )
      atomicRegions.push(
        createAccessRegion(
          bounds,
          availableZ.some((z) => !targetLayers.includes(z))
            ? availableZ
            : targetLayers,
        ),
      )
    }
  }

  const alignedRegions = compactTopologyMergingRegions(atomicRegions).map(
    (region) => {
      const addsLayer = region.availableZ.some(
        (z) => !targetLayers.includes(z),
      )
      const width = region.bounds.maxX - region.bounds.minX
      const height = region.bounds.maxY - region.bounds.minY
      return addsLayer && Math.min(width, height) < viaDiameter
        ? createAccessRegion(region.bounds, targetLayers)
        : region
    },
  )

  return compactTopologyMergingRegions(alignedRegions)
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

  const crossLayerAccessOverlaps = crossLayerAccessNodes.flatMap(
    (candidate) => {
      if (candidate === node) return []
      const isFree = !candidate._containsObstacle
      const isSameNetTarget =
        candidate._containsTarget && shareConnectionAlias(node, candidate)
      if (!isFree && !isSameNetTarget) return []

      const bounds = getCrossLayerAccessOverlap(node, candidate)
      return bounds
        ? [
            {
              bounds,
              availableZ: [...candidate.availableZ],
              isTarget: !isFree,
            },
          ]
        : []
    },
  )
  if (crossLayerAccessOverlaps.length === 0) return [node]

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
  const reachableZ = getUniformCrossLayerAccess({
    targetBounds: nodeBounds,
    crossLayerAccessOverlaps,
    blockerBounds,
    targetLayers: node.availableZ,
  })
  // Free component layers prove that a via can pass through the footprint;
  // only layers with a same-net target become target-owned routing capacity.
  const targetConnectionLayers = new Set([
    ...node.availableZ,
    ...crossLayerSameNetTargets.flatMap((target) => target.availableZ),
  ])
  const targetIntersections = crossLayerSameNetTargets.flatMap((target) => {
    const intersection = getCrossLayerAccessOverlap(node, target)
    return intersection ? [intersection] : []
  })
  if (reachableZ) {
    const accessZ = reachableZ.filter((z) => targetConnectionLayers.has(z))
    // Preserve the existing uniform-target behavior. Partial access below is
    // only needed when different XY areas have different layer roles.
    const xCoordinates = getCanonicalCoordinates([
      nodeBounds.minX,
      nodeBounds.maxX,
      ...targetIntersections.flatMap((bounds) => [bounds.minX, bounds.maxX]),
    ])
    const slices = xCoordinates.slice(0, -1).map((minX, index) => {
      const maxX = xCoordinates[index + 1]!
      const width = maxX - minX
      const centerX = (minX + maxX) / 2
      const isCrossLayerTargetColumn = targetIntersections.some(
        (bounds) => centerX >= bounds.minX && centerX <= bounds.maxX,
      )
      const availableZ =
        !isCrossLayerTargetColumn && Math.min(width, node.height) >= viaDiameter
          ? accessZ
          : node.availableZ

      return {
        ...node,
        capacityMeshNodeId: `${node.capacityMeshNodeId}:cross-layer-slice:${index}`,
        center: { x: centerX, y: node.center.y },
        width,
        availableZ,
        layer: `z${availableZ.join(",")}`,
      }
    })

    return slices.some(
      ({ availableZ }) => availableZ.length > node.availableZ.length,
    )
      ? slices
      : [node]
  }

  const hasViaSizedTargetOverlap = targetIntersections.some(
    (bounds) =>
      Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) >=
      viaDiameter,
  )
  if (hasViaSizedTargetOverlap) return [node]

  const regions = getAlignedCrossLayerAccessRegions({
    targetBounds: nodeBounds,
    crossLayerAccessOverlaps,
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
            // The global target remains authoritative; component nodes only prove
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
