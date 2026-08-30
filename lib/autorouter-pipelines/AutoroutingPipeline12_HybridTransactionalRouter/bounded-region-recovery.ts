import type { DynamicRoutingRegion } from "./planning-types"
import type { HybridCoreFailureCode } from "./rust-core-protocol"
import type { HybridBoardBounds } from "./types"

export function createExpandedRegionRequeue({
  region,
  boardBounds,
  requeueIndex,
}: {
  region: DynamicRoutingRegion
  boardBounds: HybridBoardBounds
  requeueIndex: number
}): DynamicRoutingRegion | undefined {
  if (!Number.isSafeInteger(requeueIndex) || requeueIndex <= 0) {
    throw new Error("region requeue index must be a positive safe integer")
  }
  const expansionMm = region.overlapReserveMm * 3
  const maximumEnvelope = Object.freeze({
    minX: Math.max(boardBounds.minX, region.maximumEnvelope.minX - expansionMm),
    maxX: Math.min(boardBounds.maxX, region.maximumEnvelope.maxX + expansionMm),
    minY: Math.max(boardBounds.minY, region.maximumEnvelope.minY - expansionMm),
    maxY: Math.min(boardBounds.maxY, region.maximumEnvelope.maxY + expansionMm),
  })
  if (boundsEqual(maximumEnvelope, region.maximumEnvelope)) return undefined
  return Object.freeze({
    ...region,
    maximumEnvelope,
    mutationGeneration: region.mutationGeneration + 1,
  })
}

export function isEnvelopeRecoveryEligible({
  failureCode,
  coreFailureCode,
}: {
  failureCode: string
  coreFailureCode?: HybridCoreFailureCode
}): boolean {
  return failureCode === "core_search_failed" && coreFailureCode === "no_legal_path"
}

function boundsEqual(
  first: HybridBoardBounds,
  second: HybridBoardBounds,
): boolean {
  return (
    first.minX === second.minX &&
    first.maxX === second.maxX &&
    first.minY === second.minY &&
    first.maxY === second.maxY
  )
}
