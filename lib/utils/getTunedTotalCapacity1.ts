import { CapacityMeshNode } from "lib/types/capacity-mesh-types"

/**
 * Calculate the capacity of a node based on its width
 *
 * This capacity corresponds to how many vias the node can fit, tuned for two
 * layers.
 *
 * @param node The node or width to calculate capacity for
 * @param maxCapacityFactor Optional multiplier to adjust capacity
 * @returns The calculated capacity
 */
export const getTunedTotalCapacity1 = (
  node:
    | CapacityMeshNode
    | { width: number; height?: number; availableZ?: number[] },
  maxCapacityFactor = 1,
  opts: { viaDiameter?: number; obstacleMargin?: number } = {},
) => {
  const VIA_DIAMETER = opts.viaDiameter ?? 0.3
  const TRACE_WIDTH = 0.15
  const width = "width" in node ? node.width : node
  const obstacleMargin = opts.obstacleMargin ?? 0.2
  const height =
    "height" in node && typeof node.height === "number" ? node.height : width
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return 0
  }
  if (width <= 0 || height <= 0) {
    return 0
  }
  const minSide = Math.min(width, height)

  const effectiveNodeSpan = Math.sqrt(width * height)
  const narrowSideViaRatio = minSide / (VIA_DIAMETER + obstacleMargin)
  const viaRatioFactor = Math.min(
    1.2,
    Math.max(0.85, narrowSideViaRatio ** 0.05),
  )
  const viaLengthAcross =
    (effectiveNodeSpan * viaRatioFactor) / (VIA_DIAMETER / 2 + obstacleMargin)

  const tunedTotalCapacity = (viaLengthAcross / 2) ** 1.1 * maxCapacityFactor
  if (!Number.isFinite(tunedTotalCapacity)) {
    return 0
  }

  if (node.availableZ?.length === 1 && tunedTotalCapacity > 1) {
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
