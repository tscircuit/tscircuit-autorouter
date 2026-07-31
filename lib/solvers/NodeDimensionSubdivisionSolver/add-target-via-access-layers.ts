import type { Bounds } from "@tscircuit/math-utils"
import type { CapacityMeshNode } from "lib/types"

const EPSILON = 1e-6

function getOverlapDimensions(
  a: CapacityMeshNode,
  b: CapacityMeshNode,
): { width: number; height: number } {
  return {
    width:
      Math.min(a.center.x + a.width / 2, b.center.x + b.width / 2) -
      Math.max(a.center.x - a.width / 2, b.center.x - b.width / 2),
    height:
      Math.min(a.center.y + a.height / 2, b.center.y + b.height / 2) -
      Math.max(a.center.y - a.height / 2, b.center.y - b.height / 2),
  }
}

function containsNode(
  container: CapacityMeshNode,
  contained: CapacityMeshNode,
): boolean {
  return (
    container.center.x - container.width / 2 <=
      contained.center.x - contained.width / 2 + EPSILON &&
    container.center.x + container.width / 2 >=
      contained.center.x + contained.width / 2 - EPSILON &&
    container.center.y - container.height / 2 <=
      contained.center.y - contained.height / 2 + EPSILON &&
    container.center.y + container.height / 2 >=
      contained.center.y + contained.height / 2 - EPSILON
  )
}

function shareConnectionAlias(
  a: CapacityMeshNode,
  b: CapacityMeshNode,
): boolean {
  const aliases = new Set(a._connectedTo ?? [])
  return (b._connectedTo ?? []).some((alias) => aliases.has(alias))
}

export function addTargetViaAccessLayers({
  nodes,
  layerCount,
  viaDiameter,
  componentBounds,
}: {
  nodes: CapacityMeshNode[]
  layerCount: number
  viaDiameter: number
  componentBounds: readonly Bounds[]
}): { expandedTargetNodeCount: number; freeViaPortalNodeCount: number } {
  const originalAvailableZ = new Map(
    nodes.map((node) => [node.capacityMeshNodeId, [...node.availableZ]]),
  )
  const targetNodes = nodes.filter(
    (node) => node._containsTarget && node._containsObstacle,
  )
  const freeNodes = nodes.filter(
    (node) => !node._containsTarget && !node._containsObstacle,
  )
  const isInComponentBounds = (node: CapacityMeshNode): boolean =>
    componentBounds.some(
      (bounds) =>
        node.center.x >= bounds.minX - EPSILON &&
        node.center.x <= bounds.maxX + EPSILON &&
        node.center.y >= bounds.minY - EPSILON &&
        node.center.y <= bounds.maxY + EPSILON,
    )
  const allLayers = Array.from({ length: layerCount }, (_, z) => z)
  let expandedTargetNodeCount = 0

  for (const node of targetNodes) {
    if (
      Math.min(node.width, node.height) + EPSILON < viaDiameter ||
      !isInComponentBounds(node)
    ) {
      continue
    }

    const hasSameNetTargetOnAnotherLayer = targetNodes.some((candidate) => {
      if (
        candidate === node ||
        candidate.availableZ.some((z) => node.availableZ.includes(z)) ||
        !shareConnectionAlias(node, candidate)
      ) {
        return false
      }
      const overlap = getOverlapDimensions(node, candidate)
      return overlap.width >= -EPSILON && overlap.height >= -EPSILON
    })
    const viaSizedFreeOverlaps = freeNodes.filter((candidate) => {
      const overlap = getOverlapDimensions(node, candidate)
      return (
        overlap.width + EPSILON >= viaDiameter &&
        overlap.height + EPSILON >= viaDiameter
      )
    })
    if (!hasSameNetTargetOnAnotherLayer && viaSizedFreeOverlaps.length === 0) {
      continue
    }

    const availableZ = hasSameNetTargetOnAnotherLayer
      ? allLayers
      : [
          ...new Set([
            ...node.availableZ,
            ...viaSizedFreeOverlaps.flatMap(
              (candidate) =>
                originalAvailableZ.get(candidate.capacityMeshNodeId) ?? [],
            ),
          ]),
        ].sort((a, b) => a - b)
    if (availableZ.length === node.availableZ.length) continue
    node.availableZ = availableZ
    node.layer = `z${availableZ.join(",")}`
    node._isViaAccess = true
    expandedTargetNodeCount++
  }

  const freeNodesByLayer = allLayers.map((z) =>
    freeNodes.filter((node) =>
      originalAvailableZ.get(node.capacityMeshNodeId)!.includes(z),
    ),
  )
  let freeViaPortalNodeCount = 0
  for (const node of freeNodes) {
    if (
      !isInComponentBounds(node) ||
      Math.min(node.width, node.height) + EPSILON < viaDiameter ||
      !allLayers.every((z) =>
        freeNodesByLayer[z]!.some((candidate) => containsNode(candidate, node)),
      )
    ) {
      continue
    }

    node.availableZ = [...allLayers]
    node.layer = `z${allLayers.join(",")}`
    node._isViaAccess = true
    freeViaPortalNodeCount++
  }

  return { expandedTargetNodeCount, freeViaPortalNodeCount }
}

export function hasViaAccessOverlap(
  a: CapacityMeshNode,
  b: CapacityMeshNode,
  viaDiameter: number | undefined,
): boolean {
  if (viaDiameter === undefined) return false
  const aIsFree = !a._containsObstacle && !a._containsTarget
  const bIsFree = !b._containsObstacle && !b._containsTarget
  if (!((a._isViaAccess && bIsFree) || (b._isViaAccess && aIsFree))) {
    return false
  }

  const overlap = getOverlapDimensions(a, b)
  return (
    overlap.width + EPSILON >= viaDiameter &&
    overlap.height + EPSILON >= viaDiameter
  )
}
