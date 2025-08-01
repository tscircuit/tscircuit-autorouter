import { CapacityMeshNode } from "lib/types/capacity-mesh-types";
import {
  STANDARD_TRACE_THICKNESS,
  STANDARD_VIA_DIAMETER,
} from "./getTraceThicknessFromConnection";

/**
 * Calculate the capacity of a node based on its width
 *
 * This capacity corresponds to how many vias the node can fit, tuned for two
 * layers.
 *
 * @param nodeOrWidth The node or width to calculate capacity for
 * @param maxCapacityFactor Optional multiplier to adjust capacity
 * @param traceThickness Optional trace thickness to consider (defaults to standard)
 * @param viaDiameter Optional via diameter to consider (defaults to standard)
 * @returns The calculated capacity
 */
export const getTunedTotalCapacity1 = (
  nodeOrWidth: CapacityMeshNode | { width: number; availableZ?: number[] },
  maxCapacityFactor = 1,
  traceThickness = STANDARD_TRACE_THICKNESS,
  viaDiameter = STANDARD_VIA_DIAMETER
) => {
  const obstacleMargin = 0.2;

  const width = "width" in nodeOrWidth ? nodeOrWidth.width : nodeOrWidth;

  // Calculate how many vias can fit across the width
  // Each via needs its radius plus obstacle margin on each side
  const viaLengthAcross = width / (viaDiameter / 2 + obstacleMargin);

  // Base capacity calculation - tuned empirically for good routing
  let tunedTotalCapacity = (viaLengthAcross / 2) ** 1.1 * maxCapacityFactor;

  // Adjust capacity based on trace thickness
  // Thicker traces need more space, reducing effective capacity
  const thicknessRatio = traceThickness / STANDARD_TRACE_THICKNESS;
  const thicknessPenalty = Math.sqrt(thicknessRatio); // Square root to moderate the penalty
  tunedTotalCapacity = tunedTotalCapacity / thicknessPenalty;

  // Single layer nodes can only contain one trace safely
  if (nodeOrWidth.availableZ?.length === 1 && tunedTotalCapacity > 1) {
    return 1;
  }

  return tunedTotalCapacity;
};

/**
 * Calculate the optimal subdivision depth to reach a target minimum capacity
 * @param initialWidth The initial width of the top-level node
 * @param targetMinCapacity The minimum capacity target (default 0.5)
 * @param maxDepth Maximum allowed depth (default 10)
 * @param maxTraceThickness Maximum trace thickness to consider for capacity planning
 * @param maxViaDiameter Maximum via diameter to consider for capacity planning
 * @returns The optimal capacity depth
 */
export const calculateOptimalCapacityDepth = (
  initialWidth: number,
  targetMinCapacity = 0.5,
  maxDepth = 16,
  maxTraceThickness = STANDARD_TRACE_THICKNESS,
  maxViaDiameter = STANDARD_VIA_DIAMETER
): number => {
  let depth = 0;
  let width = initialWidth;

  // Calculate capacity at each subdivision level until we reach target or max depth
  // Use the thickest trace to ensure capacity is adequate for all connections
  while (depth < maxDepth) {
    const capacity = getTunedTotalCapacity1(
      { width },
      1,
      maxTraceThickness,
      maxViaDiameter
    );

    // If capacity is below target, we've gone far enough
    if (capacity <= targetMinCapacity) {
      break;
    }

    // Move to next subdivision level (each level divides width by 2)
    width /= 2;
    depth++;
  }

  // Return depth + 1 to account for the fact that we want to subdivide
  // until the smallest nodes have capacity <= targetMinCapacity
  return Math.max(1, depth);
};
