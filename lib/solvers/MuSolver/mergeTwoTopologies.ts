import type { CapacityMeshNode } from "lib/types"
import {
  classifyLayerSpan,
  getOverlapRect,
  intersectZ,
  type LayerSpanKind,
  type RectSpec,
} from "./topologySpan"

export interface MergeTwoTopologiesInput {
  topologyA: CapacityMeshNode[]
  topologyB: CapacityMeshNode[]
  layerCount: number
}

export type MergeCaseName =
  | "every+every"
  | "every+all-but-one"
  | "all-but-one+all-but-one"

export interface MergeSeamStats {
  "every+every": number
  "every+all-but-one": number
  "all-but-one+all-but-one": number
}

/** Builds a single seam region occupying `rect` on the given z-layers. */
const makeSeamRegion = (
  aId: string,
  bId: string,
  zs: number[],
  rect: RectSpec,
): CapacityMeshNode => {
  const availableZ = [...zs].sort((p, q) => p - q)
  return {
    capacityMeshNodeId: `mu_seam_${aId}_${bId}_z${availableZ.join("-")}`,
    center: { x: rect.center.x, y: rect.center.y },
    width: rect.width,
    height: rect.height,
    availableZ,
    layer: `z${availableZ.join(",")}`,
    _muSeam: true,
  }
}

/** Splits a rect into a horizontal band (full width) at the given y center. */
const bandRect = (
  rect: RectSpec,
  bandHeight: number,
  centerY: number,
): RectSpec => ({
  center: { x: rect.center.x, y: centerY },
  width: rect.width,
  height: bandHeight,
})

const missingLayer = (node: CapacityMeshNode, layerCount: number): number => {
  for (let z = 0; z < layerCount; z += 1) {
    if (!node.availableZ.includes(z)) return z
  }
  throw new Error(
    `Expected node "${node.capacityMeshNodeId}" to be missing exactly one layer, but it covers all of 0..${layerCount - 1}`,
  )
}

export interface MergeTwoTopologiesResult {
  regions: CapacityMeshNode[]
  seamStats: MergeSeamStats
}

/**
 * Merges two independently-generated topologies by emitting "seam" regions in
 * their XY overlap that bridge the z-layers of both sides. Handles the three
 * span combinations (every/every, every/all-but-one, all-but-one/all-but-one).
 * Returns the original A regions, original B regions, and all seam regions,
 * plus a count of seam regions emitted per merge case.
 */
export const mergeTwoTopologiesWithStats = (
  input: MergeTwoTopologiesInput,
): MergeTwoTopologiesResult => {
  const { topologyA, topologyB, layerCount } = input
  const seamRegions: CapacityMeshNode[] = []
  const seamStats: MergeSeamStats = {
    "every+every": 0,
    "every+all-but-one": 0,
    "all-but-one+all-but-one": 0,
  }

  for (const a of topologyA) {
    for (const b of topologyB) {
      const overlapRect = getOverlapRect(a, b)
      if (!overlapRect) continue

      const shared = intersectZ(a, b)
      if (shared.length === 0) {
        throw new Error(
          `Regions "${a.capacityMeshNodeId}" (z=[${a.availableZ.join(
            ",",
          )}]) and "${b.capacityMeshNodeId}" (z=[${b.availableZ.join(
            ",",
          )}]) overlap in XY but share no routable z-layer, so no seam can bridge them`,
        )
      }

      const kindA: LayerSpanKind = classifyLayerSpan(a, layerCount)
      const kindB: LayerSpanKind = classifyLayerSpan(b, layerCount)

      if (kindA === "every" && kindB === "every") {
        // Every-layer + every-layer: one single-layer, per-layer-addressable
        // seam column per z across the full stack.
        for (let z = 0; z < layerCount; z += 1) {
          seamRegions.push(
            makeSeamRegion(
              a.capacityMeshNodeId,
              b.capacityMeshNodeId,
              [z],
              overlapRect,
            ),
          )
          seamStats["every+every"] += 1
        }
        continue
      }

      if (
        (kindA === "every" && kindB === "all-but-one") ||
        (kindA === "all-but-one" && kindB === "every")
      ) {
        // Full-span + missing-one-layer: bridge only on the shared layers
        // (the missing layer exists only on the every side).
        for (const z of shared) {
          seamRegions.push(
            makeSeamRegion(
              a.capacityMeshNodeId,
              b.capacityMeshNodeId,
              [z],
              overlapRect,
            ),
          )
          seamStats["every+all-but-one"] += 1
        }
        continue
      }

      if (kindA === "all-but-one" && kindB === "all-but-one") {
        const p = missingLayer(a, layerCount)
        const q = missingLayer(b, layerCount)

        if (p === q) {
          // Same missing layer: shared === a === b, one band covers the seam.
          seamRegions.push(
            makeSeamRegion(
              a.capacityMeshNodeId,
              b.capacityMeshNodeId,
              shared,
              overlapRect,
            ),
          )
          seamStats["all-but-one+all-but-one"] += 1
          continue
        }

        // Different missing layers: build a z-staircase of stacked bands so the
        // shared layers thread from A (top) through the shared middle to B.
        const bandHeight = overlapRect.height / 3
        const topY = overlapRect.center.y + bandHeight
        const midY = overlapRect.center.y
        const bottomY = overlapRect.center.y - bandHeight

        seamRegions.push(
          makeSeamRegion(
            a.capacityMeshNodeId,
            b.capacityMeshNodeId,
            a.availableZ,
            bandRect(overlapRect, bandHeight, topY),
          ),
          makeSeamRegion(
            a.capacityMeshNodeId,
            b.capacityMeshNodeId,
            shared,
            bandRect(overlapRect, bandHeight, midY),
          ),
          makeSeamRegion(
            a.capacityMeshNodeId,
            b.capacityMeshNodeId,
            b.availableZ,
            bandRect(overlapRect, bandHeight, bottomY),
          ),
        )
        seamStats["all-but-one+all-but-one"] += 3
        continue
      }

      throw new Error(
        `Unsupported layer-span combination for seam between "${a.capacityMeshNodeId}" (${kindA}) and "${b.capacityMeshNodeId}" (${kindB}); MuSolver only merges every/all-but-one spans`,
      )
    }
  }

  return {
    regions: [...topologyA, ...topologyB, ...seamRegions],
    seamStats,
  }
}

/**
 * Pure convenience wrapper matching the topology-generator contract: returns
 * only the merged regions (original A + original B + seam regions).
 */
export const mergeTwoTopologies = (
  input: MergeTwoTopologiesInput,
): CapacityMeshNode[] => {
  return mergeTwoTopologiesWithStats(input).regions
}
