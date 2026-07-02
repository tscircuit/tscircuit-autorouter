import type { CapacityMeshNode } from "lib/types"

export type LayerSpanKind = "single" | "every" | "all-but-one"

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface RectSpec {
  center: { x: number; y: number }
  width: number
  height: number
}

/**
 * Classifies how a region's availableZ relates to the full layer stack.
 * Throws (fails loud) when the span matches none of the three known shapes so
 * that malformed topologies surface immediately instead of being defaulted.
 */
export const classifyLayerSpan = (
  node: CapacityMeshNode,
  layerCount: number,
): LayerSpanKind => {
  const availableZ = node.availableZ
  if (availableZ.length === 1) return "single"

  const coversEveryLayer =
    availableZ.length === layerCount &&
    Array.from({ length: layerCount }, (_, z) => z).every((z) =>
      availableZ.includes(z),
    )
  if (coversEveryLayer) return "every"

  if (availableZ.length === layerCount - 1) return "all-but-one"

  throw new Error(
    `Cannot classify layer span for node "${node.capacityMeshNodeId}" with availableZ=[${availableZ.join(
      ",",
    )}] against layerCount=${layerCount}`,
  )
}

export const getBounds = (node: CapacityMeshNode): Bounds => ({
  minX: node.center.x - node.width / 2,
  minY: node.center.y - node.height / 2,
  maxX: node.center.x + node.width / 2,
  maxY: node.center.y + node.height / 2,
})

export const doBoundsOverlap = (
  a: Bounds,
  b: Bounds,
  epsilon = 0,
): boolean => {
  return (
    a.minX < b.maxX - epsilon &&
    a.maxX > b.minX + epsilon &&
    a.minY < b.maxY - epsilon &&
    a.maxY > b.minY + epsilon
  )
}

/**
 * Returns the XY overlap rect of two regions, or null when they do not overlap
 * in XY at all (touching edges count as no overlap).
 */
export const getOverlapRect = (
  a: CapacityMeshNode,
  b: CapacityMeshNode,
): RectSpec | null => {
  const boundsA = getBounds(a)
  const boundsB = getBounds(b)

  const minX = Math.max(boundsA.minX, boundsB.minX)
  const minY = Math.max(boundsA.minY, boundsB.minY)
  const maxX = Math.min(boundsA.maxX, boundsB.maxX)
  const maxY = Math.min(boundsA.maxY, boundsB.maxY)

  if (maxX <= minX || maxY <= minY) return null

  return {
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    width: maxX - minX,
    height: maxY - minY,
  }
}

export const intersectZ = (
  a: CapacityMeshNode,
  b: CapacityMeshNode,
): number[] => {
  const bSet = new Set(b.availableZ)
  return a.availableZ.filter((z) => bSet.has(z)).sort((p, q) => p - q)
}

export const unionZ = (
  a: CapacityMeshNode,
  b: CapacityMeshNode,
): number[] => {
  return [...new Set([...a.availableZ, ...b.availableZ])].sort((p, q) => p - q)
}
