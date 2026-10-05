import { CachableSolver, CacheProvider } from "lib/cache/types"
import { UnravelSectionSolver } from "./UnravelSectionSolver"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import {
  PointModificationsMap,
  SegmentPointId,
  UnravelCandidate,
} from "./types"
import { createPointModificationsHash } from "./createPointModificationsHash"
import { BaseSolver } from "../BaseSolver"
import stableStringify from "fast-json-stable-stringify"
import objectHash from "object-hash"
import { getIssuesInSection } from "./getIssuesInSection"
import { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { SegmentId } from "./types"
import { LocalStorageCache } from "lib/cache/LocalStorageCache"
import {
  getGlobalLocalStorageCache,
  setupGlobalCaches,
} from "lib/cache/setupGlobalCaches"
import {
  translate,
  type Matrix,
  applyToPoint,
  applyToPoints,
  scale,
  compose,
} from "transformation-matrix"

// Normalized IDs are simple strings like "node_0", "sp_1", etc.
type NormalizedId = string

// Helper function to round to nearest 50 microns (0.05 mm) and return as string
const approximateCoordinate = (coord: number): string => {
  // Multiply by 20 (1 / 0.05), round, then divide by 20
  // Use toFixed(2) to ensure consistent string format like "1.20" or "0.05"
  return (Math.round(coord * 20) / 20).toFixed(2)
}

// Helper function to round to nearest micron (0.001 mm) and return as string.
const approximateDeltaCoordinate = (coord: number): string => {
  // Multiply by 1000 (1 / 0.001), round, then divide by 1000
  // Use toFixed(3) to ensure consistent string format like "1.200" or "0.005"
  return (Math.round(coord * 1000) / 1000).toFixed(3)
}

interface CacheToUnravelSectionTransform {
  realToCacheTransform: Matrix
  // Mappings from original UUIDs to normalized IDs
  nodeIdMap: Map<CapacityMeshNodeId, NormalizedId>
  segmentIdMap: Map<SegmentId, NormalizedId>
  segmentPointIdMap: Map<SegmentPointId, NormalizedId>
  // Reverse mappings from normalized IDs back to original UUIDs
  reverseNodeIdMap: Map<NormalizedId, CapacityMeshNodeId>
  reverseSegmentIdMap: Map<NormalizedId, SegmentId>
  reverseSegmentPointIdMap: Map<NormalizedId, SegmentPointId>
}
type CachedSolvedUnravelSection =
  | {
      success: true
      // Store the DELTA using NORMALIZED IDs and APPROXIMATED coordinate offsets (as strings)
      bestCandidatePointModificationsDelta: Array<
        [NormalizedId, { dx?: string; dy?: string; dz?: number }] // Normalized ID and approximated coord deltas (dx, dy as string)
      >
      // Store the 'f' value to reconstruct the candidate accurately
      bestCandidateF: number
    }
  | { success: false }

setupGlobalCaches()

export class CachedUnravelSectionSolver
  extends UnravelSectionSolver
  implements
    CachableSolver<CacheToUnravelSectionTransform, CachedSolvedUnravelSection>
{
  cacheHit = false
  cacheProvider: CacheProvider | null
  declare cacheToSolveSpaceTransform?:
    | CacheToUnravelSectionTransform
    | undefined
  hasAttemptedToUseCache = false

  constructor(
    params: ConstructorParameters<typeof UnravelSectionSolver>[0] & {
      cacheProvider?: CacheProvider | null
    },
  ) {
    super(params)
    this.cacheProvider =
      params.cacheProvider === undefined
        ? getGlobalLocalStorageCache() // Default to in-memory if undefined
        : params.cacheProvider // Use null if explicitly passed as null
  }

  _step() {
    if (!this.hasAttemptedToUseCache && this.cacheProvider) {
      if (this.attemptToUseCacheSync()) return
    }
    super._step()
    if ((this.solved || this.failed) && this.cacheProvider) {
      this.saveToCacheSync()
    }
  }

  computeCacheKeyAndTransform(): {
    cacheKey: string
    cacheToSolveSpaceTransform: CacheToUnravelSectionTransform
  } {
    // 1. Calculate Transformation Matrix (currently just translation)
    const rootNode = this.nodeMap.get(this.rootNodeId)!
    const realToCacheTransform = translate(
      -rootNode.center.x,
      -rootNode.center.y,
    )
    // TODO: Add scaling here in the future if needed, e.g.,
    // const scaleFactor = 1 / someUnit;
    // const realToCacheTransform = compose(
    //   translate(-rootNode.center.x, -rootNode.center.y),
    //   scale(scaleFactor, scaleFactor)
    // );

    // 2. Create ID Mappings
    const nodeIdMap = new Map<CapacityMeshNodeId, NormalizedId>()
    const reverseNodeIdMap = new Map<NormalizedId, CapacityMeshNodeId>()
    const segmentIdMap = new Map<SegmentId, NormalizedId>()
    const reverseSegmentIdMap = new Map<NormalizedId, SegmentId>()
    const segmentPointIdMap = new Map<SegmentPointId, NormalizedId>()
    const reverseSegmentPointIdMap = new Map<NormalizedId, SegmentPointId>()

    let nodeCounter = 0
    let segmentCounter = 0
    let spCounter = 0

    // Sort node IDs for deterministic normalized IDs based on coordinates (x then y)
    const sortedNodeIds = [...this.unravelSection.allNodeIds].sort(
      (aNId, bNId) => {
        const n1 = this.nodeMap.get(aNId)!
        const n2 = this.nodeMap.get(bNId)!

        if (n1.center.x !== n2.center.x) {
          return n1.center.x - n2.center.x
        }
        return n1.center.y - n2.center.y
      },
    )
    for (const nodeId of sortedNodeIds) {
      const normId = `node_${nodeCounter++}`
      nodeIdMap.set(nodeId, normId)
      reverseNodeIdMap.set(normId, nodeId)
    }

    // Sort segment point IDs for deterministic normalized IDs
    const sortedSegmentPointIds = [
      ...Array.from(this.unravelSection.segmentPointMap.entries())
        .sort(([, a], [, b]) => {
          if (a.x !== b.x) {
            return a.x - b.x
          }
          return a.y - b.y
        })
        .map(([id]) => id),
    ].sort()
    for (const spId of sortedSegmentPointIds) {
      const normSpId = `sp_${spCounter++}`
      segmentPointIdMap.set(spId, normSpId)
      reverseSegmentPointIdMap.set(normSpId, spId)

      const segmentId = this.unravelSection.segmentPointMap.get(spId)!.segmentId
      if (!segmentIdMap.has(segmentId)) {
        const normSegId = `seg_${segmentCounter++}`
        segmentIdMap.set(segmentId, normSegId)
        reverseSegmentIdMap.set(normSegId, segmentId)
      }
    }

    // 3. Create Normalized Structure for Hashing
    const normalizedNodes: Record<
      NormalizedId,
      {
        width: number
        height: number
        availableZ: number[]
        center: { x: string; y: string } // Coordinates are approximated strings
      }
    > = {}
    for (const [nodeId, normNodeId] of nodeIdMap.entries()) {
      const node = this.nodeMap.get(nodeId)!
      const transformedCenter = applyToPoint(realToCacheTransform, node.center)
      normalizedNodes[normNodeId] = {
        // ...node,
        width: node.width, // TODO: Scale width/height if transform includes scaling
        height: node.height,
        availableZ: node.availableZ,
        center: {
          x: approximateCoordinate(transformedCenter.x),
          y: approximateCoordinate(transformedCenter.y),
        },
      }
    }

    const normalizedSegmentPoints: Record<
      NormalizedId,
      {
        x: string // Approximated string coordinate
        y: string // Approximated string coordinate
        z: number
        // segmentId: NormalizedId // Use normalized ID
        // connectionName: string
        // Add other relevant properties if needed
      }
    > = {}
    for (const [spId, normSpId] of segmentPointIdMap.entries()) {
      const sp = this.unravelSection.segmentPointMap.get(spId)!
      const transformedPoint = applyToPoint(realToCacheTransform, {
        x: sp.x,
        y: sp.y,
      })
      normalizedSegmentPoints[normSpId] = {
        x: approximateCoordinate(transformedPoint.x),
        y: approximateCoordinate(transformedPoint.y),
        z: sp.z, // Z is not transformed by 2D matrix
        // segmentId: segmentIdMap.get(sp.segmentId)!,
        // connectionName: sp.connectionName,
      }
    }

    // Include connectivity/relationships if necessary for the hash
    // e.g., normalized segmentPairsInNode, normalized nodeIdToSegmentIds etc.
    // For simplicity, we'll hash nodes, points, and parameters for now.

    const keyData = {
      hyperParameters: this.hyperParameters,
      normalizedNodes,
      normalizedSegmentPoints,
      mutableHops: this.MUTABLE_HOPS,
    }

    // Use object-hash for potentially better handling of object structures
    // const cacheKey = stableStringify(keyData)
    const cacheKey = `unravelsec:${objectHash(keyData)}`

    const cacheToSolveSpaceTransform: CacheToUnravelSectionTransform = {
      realToCacheTransform,
      nodeIdMap,
      segmentIdMap,
      segmentPointIdMap,
      reverseNodeIdMap,
      reverseSegmentIdMap,
      reverseSegmentPointIdMap,
    }

    this.cacheKey = cacheKey
    this.cacheToSolveSpaceTransform = cacheToSolveSpaceTransform

    return { cacheKey, cacheToSolveSpaceTransform }
  }

  applyCachedSolution(cachedSolution: CachedSolvedUnravelSection): void {
    if (cachedSolution.success === false) {
      this.failed = true
      return
    }
    if (!this.cacheToSolveSpaceTransform) {
      console.error("Cache transform not available to apply cached solution.")
      return
    }

    const {
      // realToCacheTransform, // Not needed to apply deltas
      reverseSegmentPointIdMap,
      reverseNodeIdMap, // Needed if issues depend on node IDs
    } = this.cacheToSolveSpaceTransform

    // Create point modifications map using ORIGINAL IDs and ORIGINAL coordinates
    const pointModifications = new Map<
      SegmentPointId,
      { x?: number; y?: number; z?: number }
    >()

    for (const [
      normSpId,
      normDelta, // normDelta.dx and normDelta.dy are strings here
    ] of cachedSolution.bestCandidatePointModificationsDelta) {
      const originalSpId = reverseSegmentPointIdMap.get(normSpId)
      if (!originalSpId) {
        console.warn(
          `Could not find original ID for normalized SP ID: ${normSpId} when applying cache.`,
        )
        continue
      }

      const originalSegmentPoint =
        this.unravelSection.segmentPointMap.get(originalSpId)
      if (!originalSegmentPoint) {
        console.warn(
          `Could not find original segment point for ID: ${originalSpId} when applying cache.`,
        )
        continue
      }

      // Calculate absolute coordinates by applying the delta to the original point
      const modifiedPoint: { x?: number; y?: number; z?: number } = {}

      if (normDelta.dx !== undefined) {
        const dxNum = parseFloat(normDelta.dx)
        if (!Number.isNaN(dxNum)) {
          // Apply delta to the original coordinate (no translation offset needed here as delta is relative)
          modifiedPoint.x = originalSegmentPoint.x + dxNum
        } else {
          console.warn(`Failed to parse cached dx coordinate: ${normDelta.dx}`)
        }
      }
      if (normDelta.dy !== undefined) {
        const dyNum = parseFloat(normDelta.dy)
        if (!Number.isNaN(dyNum)) {
          // Apply delta to the original coordinate
          modifiedPoint.y = originalSegmentPoint.y + dyNum
        } else {
          console.warn(`Failed to parse cached dy coordinate: ${normDelta.dy}`)
        }
      }
      if (normDelta.dz !== undefined) {
        // Z delta is applied directly
        modifiedPoint.z = originalSegmentPoint.z + normDelta.dz
      }

      // Only add modification if at least one coordinate changed
      if (Object.keys(modifiedPoint).length > 0) {
        pointModifications.set(originalSpId, modifiedPoint)
      }
    }

    // Reconstruct the best candidate using ORIGINAL IDs/coords
    // Note: Issues are recalculated based on the loaded (denormalized) modifications.
    //       'g' and 'h' might not be perfectly reconstructed if they depended
    //       on the path taken, but 'f' (the primary cost) is stored.
    const issues = getIssuesInSection(
      this.unravelSection,
      this.nodeMap,
      pointModifications,
    )

    this.bestCandidate = {
      pointModifications,
      issues,
      f: cachedSolution.bestCandidateF,
      g: cachedSolution.bestCandidateF, // Assume g is the main component off for cached solution
      h: 0, // Heuristic is 0 when solution is loaded
      operationsPerformed: -1, // Indicate it's from cache, operation count unknown
      candidateHash: createPointModificationsHash(pointModifications),
    }

    this.cacheHit = true
    this.solved = true // Mark as solved since we applied a cached solution
  }

  attemptToUseCacheSync(): boolean {
    this.hasAttemptedToUseCache = true
    if (!this.cacheProvider?.isSyncCache) {
      console.log(
        "Cache provider is not synchronous, skipping sync cache check.",
      )
      return false
    }

    if (!this.cacheKey) {
      this.computeCacheKeyAndTransform()
    }

    if (!this.cacheKey) {
      console.error("Failed to compute cache key.")
      return false
    }

    try {
      const cachedSolution = this.cacheProvider.getCachedSolutionSync(
        this.cacheKey,
      )

      if (cachedSolution) {
        this.applyCachedSolution(cachedSolution as CachedSolvedUnravelSection)
        return true
      } else {
        // console.log(`Cache miss for UnravelSectionSolver: ${this.cacheKey}`)
      }
    } catch (error) {
      console.error("Error attempting to use cache:", error)
    }

    return false
  }

  saveToCacheSync(): void {
    if (this.failed) {
      this.cacheProvider?.setCachedSolutionSync(this.cacheKey!, {
        success: false,
      })
      return
    }
    if (!this.bestCandidate) return
    const {
      // realToCacheTransform, // Not needed to calculate deltas
      segmentPointIdMap,
    } = this.cacheToSolveSpaceTransform!

    // Convert best candidate modifications to NORMALIZED DELTAs with approximated coordinate offsets
    const normalizedDeltas: Array<
      [NormalizedId, { dx?: string; dy?: string; dz?: number }] // dx, dy are strings
    > = []

    for (const [
      originalSpId,
      modifiedPoint, // This contains the absolute modified coordinates {x?, y?, z?}
    ] of this.bestCandidate.pointModifications.entries()) {
      const normSpId = segmentPointIdMap.get(originalSpId)
      if (!normSpId) {
        console.warn(
          `Could not find normalized ID for original SP ID: ${originalSpId} when saving to cache.`,
        )
        continue
      }

      const originalSegmentPoint =
        this.unravelSection.segmentPointMap.get(originalSpId)
      if (!originalSegmentPoint) {
        console.warn(
          `Could not find original segment point for ID: ${originalSpId} when saving cache.`,
        )
        continue
      }

      // Calculate delta and approximate
      const normDelta: { dx?: string; dy?: string; dz?: number } = {}
      let hasDelta = false
      if (modifiedPoint.x !== undefined) {
        const dx = modifiedPoint.x - originalSegmentPoint.x
        // Only store delta if it's non-zero (within approximation tolerance)
        const approxDx = approximateDeltaCoordinate(dx)
        if (parseFloat(approxDx) !== 0) {
          normDelta.dx = approxDx
          hasDelta = true
        }
      }
      if (modifiedPoint.y !== undefined) {
        const dy = modifiedPoint.y - originalSegmentPoint.y
        const approxDy = approximateDeltaCoordinate(dy)
        if (parseFloat(approxDy) !== 0) {
          normDelta.dy = approxDy
          hasDelta = true
        }
      }
      if (modifiedPoint.z !== undefined) {
        const dz = modifiedPoint.z - originalSegmentPoint.z
        // Z doesn't need approximation, store if non-zero
        if (dz !== 0) {
          normDelta.dz = dz
          hasDelta = true
        }
      }

      // Only add to cache if there was an actual change
      if (hasDelta) {
        normalizedDeltas.push([normSpId, normDelta])
      }
    }

    const cachedSolution: CachedSolvedUnravelSection = {
      success: true,
      bestCandidatePointModificationsDelta: normalizedDeltas,
      bestCandidateF: this.bestCandidate.f,
    }

    this.cacheProvider?.setCachedSolutionSync(this.cacheKey!, cachedSolution)
  }
}
