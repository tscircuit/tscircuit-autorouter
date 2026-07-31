import type { Bounds } from "@tscircuit/math-utils"
import type { CapacityMeshNode } from "lib/types"
import {
  getBoundsIntersection,
  getCapacityMeshNodeBounds,
} from "../TopologyPlanningSolver/capacity-node-geometry"
import {
  doesBoundsContainPoint,
  getCanonicalCoordinates,
} from "./topology-merging-regions"
import type { TopologyMergingNodeGroup } from "./topology-merging-types"

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
}): CapacityMeshNode {
  if (
    viaDiameter === undefined ||
    !node._containsTarget ||
    !node._containsObstacle ||
    Math.min(node.width, node.height) < viaDiameter
  ) {
    return node
  }

  const crossLayerSameNetTargets = crossLayerAccessNodes.filter(
    (candidate) =>
      candidate._containsTarget &&
      candidate._containsObstacle &&
      shareConnectionAlias(node, candidate) &&
      getCrossLayerAccessOverlap(node, candidate) !== null,
  )
  if (crossLayerSameNetTargets.length === 0) return node

  const crossLayerAccessOverlaps = crossLayerAccessNodes.flatMap(
    (candidate) => {
      if (candidate === node) return []
      const isFree = !candidate._containsObstacle
      const isSameNetTarget =
        candidate._containsTarget && shareConnectionAlias(node, candidate)
      if (!isFree && !isSameNetTarget) return []

      const bounds = getCrossLayerAccessOverlap(node, candidate)
      return bounds ? [{ bounds, availableZ: [...candidate.availableZ] }] : []
    },
  )
  if (crossLayerAccessOverlaps.length === 0) return node

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
  if (!reachableZ) return node

  // Free component layers prove that a via can pass through the footprint;
  // only layers with a same-net target become target-owned routing capacity.
  const targetZ = new Set([
    ...node.availableZ,
    ...crossLayerSameNetTargets.flatMap((target) => target.availableZ),
  ])
  const availableZ = reachableZ.filter((z) => targetZ.has(z))

  return { ...node, availableZ, layer: `z${availableZ.join(",")}` }
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
}): Map<CapacityMeshNode, CapacityMeshNode> {
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
              ? node
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
