import type { FixedCopperRectangle } from "lib/data-structures/FixedCopperClearanceIndex"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import type { Pipeline9FixedPadClearance } from "./createPipeline9FixedPadClearance"

/** Grow/shrink maps all solve attempts back into this original physical node. */
export const createPipeline9FixedPadRectanglePredicate = ({
  node,
  fixedPadClearance,
  traceWidth,
  viaDiameter,
}: {
  node: NodeWithPortPoints
  fixedPadClearance: Pipeline9FixedPadClearance
  traceWidth: number
  viaDiameter: number
}): ((rectangle: FixedCopperRectangle) => boolean) => {
  const margin = Math.max(
    traceWidth / 2 + fixedPadClearance.traceToPadClearance,
    viaDiameter / 2 + fixedPadClearance.viaToPadClearance,
  )
  if (
    !Number.isFinite(traceWidth) ||
    traceWidth / 2 <= 0 ||
    !Number.isFinite(viaDiameter) ||
    viaDiameter / 2 <= 0 ||
    !Number.isFinite(fixedPadClearance.traceToPadClearance) ||
    fixedPadClearance.traceToPadClearance < 0 ||
    !Number.isFinite(fixedPadClearance.viaToPadClearance) ||
    fixedPadClearance.viaToPadClearance < 0 ||
    !Number.isFinite(margin)
  ) {
    throw new Error(
      "Pipeline9 fixed pad selection requires finite physical sizes and clearances",
    )
  }
  const bounds = getBoundsFromNodeWithPortPoints(node)
  if (
    ![node.center.x, node.center.y, node.width, node.height].every(
      (value): boolean => Number.isFinite(value),
    ) ||
    node.portPoints.some(
      (point): boolean => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    ) ||
    !Object.values(bounds).every((value): boolean => Number.isFinite(value)) ||
    bounds.minX > bounds.maxX ||
    bounds.minY > bounds.maxY
  ) {
    throw new Error(
      `Pipeline9 fixed pad node "${node.capacityMeshNodeId}" requires finite physical bounds and port coordinates`,
    )
  }
  // Keep every layer: a via can intersect copper between its endpoint layers.
  return (rectangle: FixedCopperRectangle): boolean => {
    const angle = (((rectangle.ccwRotationDegrees ?? 0) % 360) * Math.PI) / 180
    const cos = Math.abs(Math.cos(angle))
    const sin = Math.abs(Math.sin(angle))
    const halfWidth = (rectangle.width * cos + rectangle.height * sin) / 2
    const halfHeight = (rectangle.height * cos + rectangle.width * sin) / 2
    return (
      rectangle.center.x + halfWidth + margin >= bounds.minX &&
      rectangle.center.x - halfWidth - margin <= bounds.maxX &&
      rectangle.center.y + halfHeight + margin >= bounds.minY &&
      rectangle.center.y - halfHeight - margin <= bounds.maxY
    )
  }
}
