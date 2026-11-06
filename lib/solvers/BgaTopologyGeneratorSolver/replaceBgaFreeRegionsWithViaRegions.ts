import type { CapacityMeshNode } from "lib/types"
import {
  getBoundsIntersection,
  getCapacityMeshNodeBounds,
  isValidCapacityBounds,
} from "../TopologyPlanningSolver/capacity-node-geometry"

/** Replace free cells with continuous via space, retaining the surrounding
 * partition. Bounds are board-world points in mm, +X right and +Y up. */
export function replaceBgaFreeRegionsWithViaRegions({
  routingRegions,
  viaRegions,
}: {
  routingRegions: CapacityMeshNode[]
  viaRegions: CapacityMeshNode[]
}): CapacityMeshNode[] {
  let remainingRegions = routingRegions
  for (const [viaIndex, viaRegion] of viaRegions.entries()) {
    const viaBounds = getCapacityMeshNodeBounds(viaRegion)
    remainingRegions = remainingRegions.flatMap((node) => {
      if (node._containsObstacle || node._containsTarget) return [node]
      const bounds = getCapacityMeshNodeBounds(node)
      const overlap = getBoundsIntersection(bounds, viaBounds)
      if (!overlap) return [node]

      const remainingBounds = [
        { ...bounds, maxX: overlap.minX },
        { ...bounds, minX: overlap.maxX },
        { ...overlap, minY: bounds.minY, maxY: overlap.minY },
        { ...overlap, minY: overlap.maxY, maxY: bounds.maxY },
      ]
      return remainingBounds
        .filter(isValidCapacityBounds)
        .map((regionBounds, regionIndex) => ({
          ...node,
          capacityMeshNodeId: `${node.capacityMeshNodeId}:via${viaIndex}:${regionIndex}`,
          center: {
            x: (regionBounds.minX + regionBounds.maxX) / 2,
            y: (regionBounds.minY + regionBounds.maxY) / 2,
          },
          width: regionBounds.maxX - regionBounds.minX,
          height: regionBounds.maxY - regionBounds.minY,
        }))
    })
  }
  return [...remainingRegions, ...viaRegions]
}
