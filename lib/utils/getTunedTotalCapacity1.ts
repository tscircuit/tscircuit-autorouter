import { CapacityMeshNode } from "lib/types/capacity-mesh-types"

/**
 * Calculate the capacity of a node based on its width
 *
 * This capacity corresponds to how many vias the node can fit, tuned for two
 * layers.
 *
 * @param nodeOrWidth The node or width to calculate capacity for
 * @param maxCapacityFactor Optional multiplier to adjust capacity
 * @returns The calculated capacity
 */
export const getTunedTotalCapacity1 = (
  nodeOrWidth: CapacityMeshNode | { width: number; availableZ?: number[] },
  maxCapacityFactor = 1,
  opts: { viaDiameter?: number; obstacleMargin?: number } = {},
) => {
  const VIA_DIAMETER = opts.viaDiameter ?? 0.3
  const TRACE_WIDTH = 0.15
  const obstacleMargin = opts.obstacleMargin ?? 0.2

  const width = "width" in nodeOrWidth ? nodeOrWidth.width : nodeOrWidth
  const viaLengthAcross = width / (VIA_DIAMETER / 2 + obstacleMargin)

  const tunedTotalCapacity = (viaLengthAcross / 2) ** 1.1 * maxCapacityFactor

  if (nodeOrWidth.availableZ?.length === 1 && tunedTotalCapacity > 1) {
    return 1
  }

  return tunedTotalCapacity
}

/**
 * Calculate the optimal subdivision depth to reach a target minimum capacity
 * @param initialWidth The initial width of the top-level node
 * @param targetMinCapacity The minimum capacity target (default 0.5)
 * @param maxDepth Maximum allowed depth (default 10)
 * @returns The optimal capacity depth
 */
export const calculateOptimalCapacityDepth = (
  initialWidth: number,
  targetMinCapacity = 0.5,
  maxDepth = 16,
): number => {
  let depth = 0
  let width = initialWidth

  // Calculate capacity at each subdivision level until we reach target or max depth
  while (depth < maxDepth) {
    const capacity = getTunedTotalCapacity1({ width })

    // If capacity is below target, we've gone far enough
    if (capacity <= targetMinCapacity) {
      break
    }

    // Move to next subdivision level (each level divides width by 2)
    width /= 2
    depth++
  }

  // Return depth + 1 to account for the fact that we want to subdivide
  // until the smallest nodes have capacity <= targetMinCapacity
  return Math.max(1, depth)
}
