import type { Obstacle } from "lib/types/srj-types"
import type { Pipeline9PhysicalOwnership } from "./getPipeline9PhysicalOwnership"

/** Search obstacles and a routing connectivity map do not certify the original board. */
export const hasPipeline9OriginalPhysicalContext = (params: {
  physicalOwnership?: Pipeline9PhysicalOwnership
  physicalBoardObstacles?: Obstacle[]
}): boolean => {
  const hasOwners = params.physicalOwnership !== undefined
  const hasOriginalGeometry = params.physicalBoardObstacles !== undefined
  if (hasOwners !== hasOriginalGeometry) {
    throw new Error("Pipeline9 original physical validation requires both physicalOwnership and physicalBoardObstacles")
  }
  return hasOwners
}
