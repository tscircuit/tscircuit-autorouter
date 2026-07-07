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
}

export function splitCapacityNodeAroundCutouts({
  node,
  cutoutNodes,
}: {
  node: CapacityMeshNode
  cutoutNodes: CapacityMeshNode[]
}): CapacityMeshNode[] {
  if (node._containsObstacle || cutoutNodes.length === 0) return [node]

  let fragments: NodeFragment[] = [
    {
      bounds: getCapacityMeshNodeBounds(node),
      suffix: "",
    },
  ]

  for (let cutoutIndex = 0; cutoutIndex < cutoutNodes.length; cutoutIndex++) {
    const cutoutBounds = getCapacityMeshNodeBounds(cutoutNodes[cutoutIndex]!)
    fragments = fragments.flatMap((fragment) =>
      subtractBoundsFromFragment({
        fragment,
        cutoutBounds,
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
    }),
  )
}

function subtractBoundsFromFragment({
  fragment,
  cutoutBounds,
  cutoutIndex,
}: {
  fragment: NodeFragment
  cutoutBounds: Bounds
  cutoutIndex: number
}): NodeFragment[] {
  const intersection = getBoundsIntersection(fragment.bounds, cutoutBounds)
  if (!intersection) return [fragment]

  const candidateFragments: NodeFragment[] = [
    {
      bounds: {
        minX: fragment.bounds.minX,
        maxX: fragment.bounds.maxX,
        minY: fragment.bounds.minY,
        maxY: intersection.minY,
      },
      suffix: `${fragment.suffix}__cut_${cutoutIndex}_top`,
    },
    {
      bounds: {
        minX: fragment.bounds.minX,
        maxX: fragment.bounds.maxX,
        minY: intersection.maxY,
        maxY: fragment.bounds.maxY,
      },
      suffix: `${fragment.suffix}__cut_${cutoutIndex}_bottom`,
    },
    {
      bounds: {
        minX: fragment.bounds.minX,
        maxX: intersection.minX,
        minY: intersection.minY,
        maxY: intersection.maxY,
      },
      suffix: `${fragment.suffix}__cut_${cutoutIndex}_left`,
    },
    {
      bounds: {
        minX: intersection.maxX,
        maxX: fragment.bounds.maxX,
        minY: intersection.minY,
        maxY: intersection.maxY,
      },
      suffix: `${fragment.suffix}__cut_${cutoutIndex}_right`,
    },
  ]

  return candidateFragments.filter((candidate) =>
    isValidCapacityBounds(candidate.bounds),
  )
}

function createCapacityMeshNodeFromBounds({
  sourceNode,
  bounds,
  capacityMeshNodeId,
}: {
  sourceNode: CapacityMeshNode
  bounds: Bounds
  capacityMeshNodeId: string
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
    availableZ: [...sourceNode.availableZ],
  }
}
