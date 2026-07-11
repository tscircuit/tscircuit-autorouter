import type { Bounds } from "@tscircuit/math-utils"
import type { CapacityMeshNode } from "lib/types"
import {
  getBoundsIntersection,
  getCapacityMeshNodeBounds,
  isValidCapacityBounds,
} from "./capacity-node-geometry"

type NodeFragment = {
  bounds: Bounds
  suffix: string
  availableZ: number[]
}

export function splitCapacityNodeAroundCutouts({
  node,
  cutoutNodes,
}: {
  node: CapacityMeshNode
  cutoutNodes: CapacityMeshNode[]
}): CapacityMeshNode[] {
  if (node._containsObstacle || cutoutNodes.length === 0) return [node]

  const nodeBounds = getCapacityMeshNodeBounds(node)
  const spatiallyRelevantCutoutNodes = cutoutNodes.filter((cutoutNode) =>
    Boolean(
      getBoundsIntersection(nodeBounds, getCapacityMeshNodeBounds(cutoutNode)),
    ),
  )
  if (spatiallyRelevantCutoutNodes.length === 0) return [node]

  let fragments: NodeFragment[] = [
    {
      bounds: nodeBounds,
      suffix: "",
      availableZ: [...node.availableZ],
    },
  ]

  for (
    let cutoutIndex = 0;
    cutoutIndex < spatiallyRelevantCutoutNodes.length;
    cutoutIndex++
  ) {
    const cutoutNode = spatiallyRelevantCutoutNodes[cutoutIndex]!
    const cutoutBounds = getCapacityMeshNodeBounds(cutoutNode)
    fragments = fragments.flatMap((fragment) =>
      partitionFragmentAroundCutout({
        fragment,
        cutoutBounds,
        cutoutAvailableZ: cutoutNode.availableZ,
        cutoutIndex,
      }),
    )
  }

  if (fragments.length === 1 && fragments[0]!.suffix === "") return [node]

  return fragments.map((fragment, index) =>
    createCapacityMeshNodeFromBounds({
      sourceNode: node,
      bounds: fragment.bounds,
      capacityMeshNodeId: `${node.capacityMeshNodeId}__merge_${index}${fragment.suffix}`,
      availableZ: fragment.availableZ,
    }),
  )
}

/**
 * Partitions one spatial fragment without separating layers that remain
 * jointly routable. Outer pieces keep every source layer, while the overlap
 * keeps only layers not occupied by the cutout.
 */
function partitionFragmentAroundCutout({
  fragment,
  cutoutBounds,
  cutoutAvailableZ,
  cutoutIndex,
}: {
  fragment: NodeFragment
  cutoutBounds: Bounds
  cutoutAvailableZ: number[]
  cutoutIndex: number
}): NodeFragment[] {
  const intersection = getBoundsIntersection(fragment.bounds, cutoutBounds)
  if (!intersection) return [fragment]
  const blockedAvailableZ = new Set(
    fragment.availableZ.filter((z: number): boolean =>
      cutoutAvailableZ.includes(z),
    ),
  )
  if (blockedAvailableZ.size === 0) return [fragment]

  const candidateFragments: NodeFragment[] = [
    {
      bounds: {
        minX: fragment.bounds.minX,
        maxX: fragment.bounds.maxX,
        minY: fragment.bounds.minY,
        maxY: intersection.minY,
      },
      suffix: `${fragment.suffix}__cut_${cutoutIndex}_top`,
      availableZ: fragment.availableZ,
    },
    {
      bounds: {
        minX: fragment.bounds.minX,
        maxX: fragment.bounds.maxX,
        minY: intersection.maxY,
        maxY: fragment.bounds.maxY,
      },
      suffix: `${fragment.suffix}__cut_${cutoutIndex}_bottom`,
      availableZ: fragment.availableZ,
    },
    {
      bounds: {
        minX: fragment.bounds.minX,
        maxX: intersection.minX,
        minY: intersection.minY,
        maxY: intersection.maxY,
      },
      suffix: `${fragment.suffix}__cut_${cutoutIndex}_left`,
      availableZ: fragment.availableZ,
    },
    {
      bounds: {
        minX: intersection.maxX,
        maxX: fragment.bounds.maxX,
        minY: intersection.minY,
        maxY: intersection.maxY,
      },
      suffix: `${fragment.suffix}__cut_${cutoutIndex}_right`,
      availableZ: fragment.availableZ,
    },
  ]

  const unblockedIntersectionLayers = fragment.availableZ.filter(
    (z: number): boolean => !blockedAvailableZ.has(z),
  )
  if (unblockedIntersectionLayers.length > 0) {
    candidateFragments.push({
      bounds: intersection,
      suffix: `${fragment.suffix}__cut_${cutoutIndex}_remaining_layers`,
      availableZ: unblockedIntersectionLayers,
    })
  }

  return candidateFragments.filter(
    (candidate) =>
      isValidCapacityBounds(candidate.bounds) &&
      candidate.availableZ.length > 0,
  )
}

function createCapacityMeshNodeFromBounds({
  sourceNode,
  bounds,
  capacityMeshNodeId,
  availableZ,
}: {
  sourceNode: CapacityMeshNode
  bounds: Bounds
  capacityMeshNodeId: string
  availableZ: number[]
}): CapacityMeshNode {
  return {
    ...sourceNode,
    capacityMeshNodeId,
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    availableZ: [...availableZ],
    layer: `z${availableZ.join(",")}`,
  }
}
