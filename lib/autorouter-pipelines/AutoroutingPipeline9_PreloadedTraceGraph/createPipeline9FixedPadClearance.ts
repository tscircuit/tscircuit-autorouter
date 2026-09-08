import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  FixedCopperClearanceIndex,
  type FixedCopperRectangle,
} from "lib/data-structures/FixedCopperClearanceIndex"
import type { Obstacle } from "lib/types/srj-types"
import { getObstacleZLayersOnBoard } from "lib/utils/create-srj-with-board-valid-obstacle-layers"

export type Pipeline9FixedPadClearance = {
  readonly rectangles: readonly FixedCopperRectangle[]
  readonly traceClearanceIndex: FixedCopperClearanceIndex
  readonly viaClearanceIndex: FixedCopperClearanceIndex
  readonly layerCount: number
  readonly traceToPadClearance: number
  readonly viaToPadClearance: number
}

/**
 * Prepare the original SRJ's fixed rectangles once for physical routing.
 * Assignable copper remains under its existing claim-aware routing contract;
 * its initial connectedTo identifiers are not an assignment to a routed net.
 */
export const createPipeline9FixedPadClearance = (params: {
  readonly obstacles: readonly Obstacle[]
  readonly connMap: ConnectivityMap
  readonly layerCount: number
  readonly traceToPadClearance: number
  readonly viaToPadClearance: number
}): Pipeline9FixedPadClearance => {
  const rectangles: FixedCopperRectangle[] = []
  for (const [obstacleIndex, obstacle] of params.obstacles.entries()) {
    if (obstacle.netIsAssignable === true) continue
    if (obstacle.type !== "rect") {
      throw new Error(
        `Pipeline9 fixed pad ${obstacleIndex} is not represented as a rectangle`,
      )
    }
    const ownerNetIds = new Set<string>()
    const ownerIds = new Set([
      ...obstacle.connectedTo,
      ...(obstacle.offBoardConnectsTo ?? []),
    ])
    for (const ownerId of ownerIds) {
      if (typeof ownerId !== "string" || ownerId.length === 0) {
        throw new Error(
          `Pipeline9 fixed pad ${obstacleIndex} has an invalid electrical owner identifier`,
        )
      }
      const canonicalNetId = params.connMap.getNetConnectedToId(ownerId)
      if (typeof canonicalNetId !== "string" || canonicalNetId.length === 0) {
        throw new Error(
          `Pipeline9 fixed pad ${obstacleIndex} has no connectivity-map owner for "${ownerId}"`,
        )
      }
      ownerNetIds.add(canonicalNetId)
    }
    // Approximation and deduplication may remove a source geometry ID without
    // removing its electrical identities. Only an existing map association
    // makes this optional ID an owner; its absence is not an electrical claim.
    if (obstacle.obstacleId !== undefined) {
      const canonicalNetId = params.connMap.getNetConnectedToId(
        obstacle.obstacleId,
      )
      if (canonicalNetId !== undefined) {
        if (typeof canonicalNetId !== "string" || canonicalNetId.length === 0) {
          throw new Error(
            `Pipeline9 fixed pad ${obstacleIndex} has an invalid connectivity-map owner for its geometry identifier`,
          )
        }
        ownerNetIds.add(canonicalNetId)
      }
    }
    if (ownerNetIds.size > 1) {
      throw new Error(
        `Pipeline9 fixed pad ${obstacleIndex} has inconsistent canonical ownership`,
      )
    }
    const zLayers = getObstacleZLayersOnBoard(obstacle, params.layerCount)
    rectangles.push({
      kind: "fixed-rectangle",
      center: { ...obstacle.center },
      width: obstacle.width,
      height: obstacle.height,
      ccwRotationDegrees: obstacle.ccwRotationDegrees,
      zLayers: [...zLayers],
      ownerNetIds,
    })
  }
  const traceClearanceIndex = new FixedCopperClearanceIndex({
    rectangles,
    layerCount: params.layerCount,
    minClearance: params.traceToPadClearance,
  })
  const viaClearanceIndex = new FixedCopperClearanceIndex({
    rectangles,
    layerCount: params.layerCount,
    minClearance: params.viaToPadClearance,
  })
  return {
    rectangles,
    traceClearanceIndex,
    viaClearanceIndex,
    layerCount: params.layerCount,
    traceToPadClearance: params.traceToPadClearance,
    viaToPadClearance: params.viaToPadClearance,
  }
}
