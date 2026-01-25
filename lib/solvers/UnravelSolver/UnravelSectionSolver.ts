import { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { BaseSolver } from "../BaseSolver"
import { SegmentWithAssignedPoints } from "../CapacityMeshSolver/CapacitySegmentToPointSolver"
import {
  UnravelSection,
  UnravelCandidate,
  SegmentPoint,
  SegmentPointId,
  SegmentId,
  UnravelOperation,
  UnravelIssue,
  SegmentPointMap,
} from "./types"
import { getNodesNearNode } from "./getNodesNearNode"
import { GraphicsObject } from "graphics-debug"
import {
  createFullPointModificationsHash,
  createPointModificationsHash,
} from "./createPointModificationsHash"
import { getIssuesInSection } from "./getIssuesInSection"
import { getTunedTotalCapacity1 } from "lib/utils/getTunedTotalCapacity1"
import { applyOperationToPointModifications } from "./applyOperationToPointModifications"
import {
  createSegmentPointMap,
  SegmentPointMapAndReverseMaps,
} from "./createSegmentPointMap"
import { calculateNodeProbabilityOfFailure } from "./calculateCrossingProbabilityOfFailure"
import { PointModificationsMap } from "./types"

export interface UnravelSectionHyperParameters {
  MAX_ITERATIONS_WITHOUT_IMPROVEMENT: number
}

interface UnravelSectionSolverParams {
  rootNodeId: CapacityMeshNodeId
  colorMap?: Record<string, string>
  MUTABLE_HOPS?: number
  nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>
  dedupedSegments: SegmentWithAssignedPoints[]
  dedupedSegmentMap?: Map<SegmentId, SegmentWithAssignedPoints>
  nodeIdToSegmentIds: Map<CapacityMeshNodeId, CapacityMeshNodeId[]>
  segmentIdToNodeIds: Map<CapacityMeshNodeId, CapacityMeshNodeId[]>
  segmentPointMap?: SegmentPointMap
  nodeToSegmentPointMap?: Map<CapacityMeshNodeId, SegmentPointId[]>
  segmentToSegmentPointMap?: Map<SegmentId, SegmentPointId[]>
  hyperParameters?: Partial<UnravelSectionHyperParameters>
}

/**
 * The UntangleSectionSolver optimizes a section of connected capacity nodes
 * with their deduplicated segments.
 *
 * The section always has a "root" node. From the root node, MUTABLE_HOPS are
 * taken to reach other nodes that are mutable. One additional hop is taken to
 * have all the impacted nodes in section. So a section is composed of mutable
 * and immutable nodes.
 *
 * The goal of the solver is to perform operations on the mutable nodes of the
 * section to lower the overall cost of the section.
 *
 * The untangle phase will perform "operations" on segments based on "issues"
 *
 * An "issue" is anything that increases the cost of the node:
 * - Anything that causes a via (e.g. layer transition)
 * - Any time two traces cross on the same layer
 *
 * An operation is a change to a segment. There are two main operations:
 * - Change layer
 * - Change point order on segment
 *
 * This solver works by exploring different paths of operations. When an
 * operation is performed, new issues are created. Each path has a cost, and
 * a set of neighbors representing next operations to perform.
 *
 */
export class UnravelSectionSolver extends BaseSolver {
  override getSolverName(): string {
    return "UnravelSectionSolver"
  }

  nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>
  dedupedSegments: SegmentWithAssignedPoints[]
  dedupedSegmentMap: Map<SegmentId, SegmentWithAssignedPoints>

  MUTABLE_HOPS = 1

  unravelSection: UnravelSection

  candidates: UnravelCandidate[] = []

  lastProcessedCandidate: UnravelCandidate | null = null
  bestCandidate: UnravelCandidate | null = null
  originalCandidate: UnravelCandidate

  rootNodeId: CapacityMeshNodeId
  nodeIdToSegmentIds: Map<CapacityMeshNodeId, CapacityMeshNodeId[]>
  segmentIdToNodeIds: Map<CapacityMeshNodeId, CapacityMeshNodeId[]>
  colorMap: Record<string, string>
  tunedNodeCapacityMap: Map<CapacityMeshNodeId, number>
  MAX_CANDIDATES = 500
  iterationsSinceImprovement = 0

  hyperParameters: UnravelSectionHyperParameters

  selectedCandidateIndex: number | "best" | "original" | null = null

  queuedOrExploredCandidatePointModificationHashes: Set<string> = new Set()

  constructorParams: UnravelSectionSolverParams

  constructor(params: UnravelSectionSolverParams) {
    super()

    this.constructorParams = params

    this.MUTABLE_HOPS = params.MUTABLE_HOPS ?? this.MUTABLE_HOPS
    this.MAX_ITERATIONS = 50_000

    this.hyperParameters = {
      ...params.hyperParameters,
      MAX_ITERATIONS_WITHOUT_IMPROVEMENT: 200,
    }

    this.nodeMap = params.nodeMap
    this.dedupedSegments = params.dedupedSegments
    if (params.dedupedSegmentMap) {
      this.dedupedSegmentMap = params.dedupedSegmentMap
    } else {
      this.dedupedSegmentMap = new Map()
      for (const segment of this.dedupedSegments) {
        this.dedupedSegmentMap.set(segment.nodePortSegmentId!, segment)
      }
    }
    this.nodeIdToSegmentIds = params.nodeIdToSegmentIds
    this.segmentIdToNodeIds = params.segmentIdToNodeIds
    this.rootNodeId = params.rootNodeId
    this.colorMap = params.colorMap ?? {}
    this.unravelSection = this.createUnravelSection({
      segmentPointMap: params.segmentPointMap!,
      nodeToSegmentPointMap: params.nodeToSegmentPointMap!,
      segmentToSegmentPointMap: params.segmentToSegmentPointMap!,
    })
    this.tunedNodeCapacityMap = new Map()
    for (const nodeId of this.unravelSection.allNodeIds) {
      this.tunedNodeCapacityMap.set(
        nodeId,
        getTunedTotalCapacity1(this.nodeMap.get(nodeId)!),
      )
    }
    this.originalCandidate = this.createInitialCandidate()
    this.candidates = [this.originalCandidate]
  }

  getConstructorParams(): UnravelSectionSolverParams {
    return {
      ...this.constructorParams,
      // use the section maps instead of the global maps
      segmentPointMap: this.unravelSection.segmentPointMap,
      nodeToSegmentPointMap: this.unravelSection.segmentPointsInNode,
      segmentToSegmentPointMap: this.unravelSection.segmentPointsInSegment,
    }
  }

  createUnravelSection(
    largeSpMaps?: SegmentPointMapAndReverseMaps,
  ): UnravelSection {
    const mutableNodeIds = getNodesNearNode({
      nodeId: this.rootNodeId,
      nodeIdToSegmentIds: this.nodeIdToSegmentIds,
      segmentIdToNodeIds: this.segmentIdToNodeIds,
      hops: this.MUTABLE_HOPS,
    })
    const allSectionNodeIds = getNodesNearNode({
      nodeId: this.rootNodeId,
      nodeIdToSegmentIds: this.nodeIdToSegmentIds,
      segmentIdToNodeIds: this.segmentIdToNodeIds,
      hops: this.MUTABLE_HOPS + 1,
    })
    const immutableNodeIds = Array.from(
      new Set(allSectionNodeIds).difference(new Set(mutableNodeIds)),
    )

    if (!largeSpMaps?.segmentPointMap) {
      largeSpMaps = createSegmentPointMap(
        this.dedupedSegments,
        this.segmentIdToNodeIds,
      )
    }

    const segmentPointsInNode = new Map<CapacityMeshNodeId, SegmentPointId[]>()
    for (const nodeId of allSectionNodeIds) {
      segmentPointsInNode.set(
        nodeId,
        largeSpMaps.nodeToSegmentPointMap.get(nodeId)!,
      )
    }

    const sectionPointMap = new Map<SegmentPointId, SegmentPoint>()
    for (const nodeId of allSectionNodeIds) {
      for (const segmentPointId of segmentPointsInNode.get(nodeId)!) {
        const point = largeSpMaps.segmentPointMap.get(segmentPointId)!
        sectionPointMap.set(segmentPointId, point)
      }
    }

    const segmentPoints = Array.from(sectionPointMap.values())

    const segmentPointsInSegment = new Map<SegmentId, SegmentPointId[]>()
    for (const segmentPoint of segmentPoints) {
      segmentPointsInSegment.set(segmentPoint.segmentId, [
        ...(segmentPointsInSegment.get(segmentPoint.segmentId) ?? []),
        segmentPoint.segmentPointId,
      ])
    }

    // Second pass: set neighboring segment point ids
    for (const [nodeId, segmentPoints] of segmentPointsInNode.entries()) {
      for (let i = 0; i < segmentPoints.length; i++) {
        const A = largeSpMaps.segmentPointMap.get(segmentPoints[i])!
        for (let j = i + 1; j < segmentPoints.length; j++) {
          const B = largeSpMaps.segmentPointMap.get(segmentPoints[j])!

          if (B.segmentPointId === A.segmentPointId) continue
          if (B.segmentId === A.segmentId) continue
          if (B.connectionName !== A.connectionName) continue
          if (B.directlyConnectedSegmentPointIds.includes(A.segmentPointId))
            continue

          A.directlyConnectedSegmentPointIds.push(B.segmentPointId)
          B.directlyConnectedSegmentPointIds.push(A.segmentPointId)
        }
      }
    }

    const segmentPairsInNode = new Map<
      CapacityMeshNodeId,
      Array<[SegmentPointId, SegmentPointId]>
    >()
    for (const nodeId of allSectionNodeIds) {
      segmentPairsInNode.set(nodeId, [])
    }

    for (const A of segmentPoints) {
      for (const nodeId of A.capacityMeshNodeIds) {
        const segmentPairs = segmentPairsInNode.get(nodeId)
        if (!segmentPairs) continue
        for (const BId of A.directlyConnectedSegmentPointIds) {
          const B = largeSpMaps.segmentPointMap.get(BId)!
          if (B.segmentPointId === A.segmentPointId) continue
          if (!B.capacityMeshNodeIds.some((nId) => nId === nodeId)) continue
          if (
            !segmentPairs.some(
              ([a, b]) =>
                (a === A.segmentPointId && b === B.segmentPointId) ||
                (a === B.segmentPointId && b === A.segmentPointId),
            )
          ) {
            segmentPairs.push([A.segmentPointId, B.segmentPointId])
          }
        }
      }
    }

    const mutableSegmentIds = new Set<string>()
    for (const nodeId of mutableNodeIds) {
      for (const segmentId of this.nodeIdToSegmentIds.get(nodeId)!) {
        const allNodeIdsWithSegment = this.segmentIdToNodeIds.get(segmentId)!
        if (
          allNodeIdsWithSegment.every(
            (nodeId) => !this.nodeMap.get(nodeId)!._containsTarget,
          )
        ) {
          mutableSegmentIds.add(segmentId)
        }
      }
    }

    const mutableSegmentPointIds = new Set<SegmentPointId>()
    for (const sp of segmentPoints) {
      // A segment point is mutable if it's in any mutable node
      const isInMutableNode = sp.capacityMeshNodeIds.some((id) =>
        mutableNodeIds.includes(id),
      )
      // Also consider segment points at MLCPs (multi-layer connection points) as mutable
      // since their z can be changed without requiring a via
      const segment = this.dedupedSegmentMap.get(sp.segmentId)
      const isAtMLCP = segment && segment.availableZ.length > 1

      if (isInMutableNode || isAtMLCP) {
        mutableSegmentPointIds.add(sp.segmentPointId)
      }
    }

    const zLockedSegmentPointIds = new Set<SegmentPointId>()
    for (const sp of segmentPoints) {
      const isAtTargetNode = sp.capacityMeshNodeIds.some(
        (id) => this.nodeMap.get(id)?._containsTarget,
      )
      if (isAtTargetNode) {
        // Only z-lock if the segment has a single available Z (single-layer connection point)
        // Multi-layer connection points (e.g., plated holes) should not be z-locked
        // so the UnravelSolver can optimize layer assignments
        const segment = this.dedupedSegmentMap.get(sp.segmentId)
        if (segment && segment.availableZ.length === 1) {
          zLockedSegmentPointIds.add(sp.segmentPointId)
        }
      }
    }

    return {
      allNodeIds: allSectionNodeIds,
      mutableNodeIds,
      immutableNodeIds,
      mutableSegmentIds,
      segmentPairsInNode,
      segmentPointMap: sectionPointMap,
      segmentPointsInNode,
      segmentPointsInSegment,
      originalPointMap: sectionPointMap,
      mutableSegmentPointIds,
      zLockedSegmentPointIds,
    }
  }

  createInitialCandidate(): UnravelCandidate {
    const pointModifications = new Map<
      SegmentPointId,
      { x?: number; y?: number; z?: number }
    >()
    const issues = getIssuesInSection(
      this.unravelSection,
      this.nodeMap,
      pointModifications,
    )
    const g = this.computeG({
      issues,
      originalCandidate: {} as any,
      operationsPerformed: 0,
      operation: {} as any,
    })
    return {
      pointModifications,
      g,
      h: 0,
      f: g,
      operationsPerformed: 0,
      candidateHash: createPointModificationsHash(pointModifications),
      // candidateFullHash: createFullPointModificationsHash(
      //   this.unravelSection.segmentPointMap,
      //   pointModifications,
      // ),
      // Ensure original candidate has issues calculated
      issues: getIssuesInSection(
        this.unravelSection,
        this.nodeMap,
        pointModifications,
      ),
    }
  }

  get nextCandidate(): UnravelCandidate | null {
    return this.candidates[0] ?? null
  }

  getPointInCandidate(
    candidate: UnravelCandidate,
    segmentPointId: SegmentPointId,
  ): { x: number; y: number; z: number; segmentId: string } {
    const originalPoint =
      this.unravelSection.segmentPointMap.get(segmentPointId)!
    const modifications = candidate.pointModifications.get(segmentPointId)

    return {
      x: modifications?.x ?? originalPoint.x,
      y: modifications?.y ?? originalPoint.y,
      z: modifications?.z ?? originalPoint.z,
      segmentId: originalPoint.segmentId,
    }
  }

  /**
   * Get all segment points in the section that belong to a given connection.
   * This is used to propose layer changes for the entire connection path
   * when all endpoints are MLCPs (multi-layer connection points).
   */
  getConnectionSegmentPointIds(connectionName: string): SegmentPointId[] {
    const result: SegmentPointId[] = []
    for (const [spId, sp] of this.unravelSection.segmentPointMap.entries()) {
      if (sp.connectionName === connectionName) {
        result.push(spId)
      }
    }
    return result
  }

  /**
   * Check if all segment points for a connection can use a given z layer.
   * Returns true if all segments have the target z in their availableZ.
   */
  canConnectionUseLayer(
    connectionSegmentPointIds: SegmentPointId[],
    targetZ: number,
  ): boolean {
    for (const spId of connectionSegmentPointIds) {
      const sp = this.unravelSection.segmentPointMap.get(spId)!
      const segment = this.dedupedSegmentMap.get(sp.segmentId)
      if (!segment || !segment.availableZ.includes(targetZ)) {
        return false
      }
    }
    return true
  }

  getOperationsForIssue(
    candidate: UnravelCandidate,
    issue: UnravelIssue,
  ): UnravelOperation[] {
    const operations: UnravelOperation[] = []

    if (issue.type === "transition_via") {
      // When there's a transition via, we attempt to change the layer of either
      // end to match the other end
      const [APointId, BPointId] = issue.segmentPoints
      const pointA = this.getPointInCandidate(candidate, APointId)
      const pointB = this.getPointInCandidate(candidate, BPointId)
      const spA = this.unravelSection.segmentPointMap.get(APointId)!
      const spB = this.unravelSection.segmentPointMap.get(BPointId)!

      const aAvailableZ = this.dedupedSegmentMap.get(
        pointA.segmentId,
      )!.availableZ
      const bAvailableZ = this.dedupedSegmentMap.get(
        pointB.segmentId,
      )!.availableZ

      const AIsZLocked =
        this.unravelSection.zLockedSegmentPointIds.has(APointId)
      const BIsZLocked =
        this.unravelSection.zLockedSegmentPointIds.has(BPointId)

      // First, try to change the entire connection to a single layer (for MLCP connections)
      // This avoids creating cascading transition_via issues
      const connectionSegmentPointIds = this.getConnectionSegmentPointIds(
        spA.connectionName,
      )

      // Try changing entire connection to pointB's z
      if (this.canConnectionUseLayer(connectionSegmentPointIds, pointB.z)) {
        const mutablePoints = connectionSegmentPointIds.filter(
          (spId) =>
            this.unravelSection.mutableSegmentPointIds.has(spId) &&
            !this.unravelSection.zLockedSegmentPointIds.has(spId),
        )
        if (mutablePoints.length > 0) {
          operations.push({
            type: "change_layer",
            newZ: pointB.z,
            segmentPointIds: mutablePoints,
          })
        }
      }

      // Try changing entire connection to pointA's z
      if (this.canConnectionUseLayer(connectionSegmentPointIds, pointA.z)) {
        const mutablePoints = connectionSegmentPointIds.filter(
          (spId) =>
            this.unravelSection.mutableSegmentPointIds.has(spId) &&
            !this.unravelSection.zLockedSegmentPointIds.has(spId),
        )
        if (mutablePoints.length > 0) {
          operations.push({
            type: "change_layer",
            newZ: pointA.z,
            segmentPointIds: mutablePoints,
          })
        }
      }

      // Also try individual point changes as fallback
      if (
        this.unravelSection.mutableSegmentPointIds.has(APointId) &&
        !AIsZLocked &&
        aAvailableZ.includes(pointB.z)
      ) {
        operations.push({
          type: "change_layer",
          newZ: pointB.z,
          segmentPointIds: [APointId],
        })
      }
      if (
        this.unravelSection.mutableSegmentPointIds.has(BPointId) &&
        !BIsZLocked &&
        bAvailableZ.includes(pointA.z)
      ) {
        operations.push({
          type: "change_layer",
          newZ: pointA.z,
          segmentPointIds: [BPointId],
        })
      }
    }

    if (issue.type === "same_layer_crossing") {
      // For a same-layer crossing, we should try all the following:
      // 1. Swap the points on each segment (for each shared segment, if any)
      // 2. Change the layer of each segment entirely to remove the crossing
      // 3. Change the layer of each point individually to make it a transition
      //   crossing

      // 1. SWAP POINTS
      const [APointId, BPointId] = issue.crossingLine1
      const [CPointId, DPointId] = issue.crossingLine2

      const sharedSegments: Array<[SegmentPointId, SegmentPointId]> = []
      const A = this.unravelSection.segmentPointMap.get(APointId)!
      const B = this.unravelSection.segmentPointMap.get(BPointId)!
      const C = this.unravelSection.segmentPointMap.get(CPointId)!
      const D = this.unravelSection.segmentPointMap.get(DPointId)!

      const AIsMutable =
        this.unravelSection.mutableSegmentPointIds.has(APointId)
      const BIsMutable =
        this.unravelSection.mutableSegmentPointIds.has(BPointId)
      const CIsMutable =
        this.unravelSection.mutableSegmentPointIds.has(CPointId)
      const DIsMutable =
        this.unravelSection.mutableSegmentPointIds.has(DPointId)

      const AIsZLocked =
        this.unravelSection.zLockedSegmentPointIds.has(APointId)
      const BIsZLocked =
        this.unravelSection.zLockedSegmentPointIds.has(BPointId)
      const CIsZLocked =
        this.unravelSection.zLockedSegmentPointIds.has(CPointId)
      const DIsZLocked =
        this.unravelSection.zLockedSegmentPointIds.has(DPointId)

      if (AIsMutable && CIsMutable && A.segmentId === C.segmentId) {
        sharedSegments.push([APointId, CPointId])
      }
      if (AIsMutable && DIsMutable && A.segmentId === D.segmentId) {
        sharedSegments.push([APointId, DPointId])
      }
      if (BIsMutable && CIsMutable && B.segmentId === C.segmentId) {
        sharedSegments.push([BPointId, CPointId])
      }
      if (BIsMutable && DIsMutable && B.segmentId === D.segmentId) {
        sharedSegments.push([BPointId, DPointId])
      }

      for (const [EPointId, FPointId] of sharedSegments) {
        operations.push({
          type: "swap_position_on_segment",
          segmentPointIds: [EPointId, FPointId],
        })
      }

      // 2. TRY CHANGING ENTIRE CONNECTION TO A DIFFERENT LAYER
      // This is more effective for MLCP connections as it avoids creating transition_via issues
      const connection1SegmentPointIds = this.getConnectionSegmentPointIds(
        A.connectionName,
      )
      const connection2SegmentPointIds = this.getConnectionSegmentPointIds(
        C.connectionName,
      )

      // Get all available Z values from the section's segments
      const availableZValues = new Set<number>()
      for (const sp of this.unravelSection.segmentPointMap.values()) {
        const segment = this.dedupedSegmentMap.get(sp.segmentId)
        if (segment) {
          for (const z of segment.availableZ) {
            availableZValues.add(z)
          }
        }
      }

      // Try moving connection 1 to each available layer different from its current one
      for (const newZ of availableZValues) {
        if (newZ === A.z) continue // Skip current layer
        if (this.canConnectionUseLayer(connection1SegmentPointIds, newZ)) {
          const mutablePoints = connection1SegmentPointIds.filter(
            (spId) =>
              this.unravelSection.mutableSegmentPointIds.has(spId) &&
              !this.unravelSection.zLockedSegmentPointIds.has(spId),
          )
          // Change all mutable points (even if not all are mutable, subsequent iterations
          // will handle the rest as transition_via issues)
          if (mutablePoints.length > 0) {
            operations.push({
              type: "change_layer",
              newZ,
              segmentPointIds: mutablePoints,
            })
          }
        }
      }

      // Try moving connection 2 to each available layer different from its current one
      for (const newZ of availableZValues) {
        if (newZ === C.z) continue // Skip current layer
        if (this.canConnectionUseLayer(connection2SegmentPointIds, newZ)) {
          const mutablePoints = connection2SegmentPointIds.filter(
            (spId) =>
              this.unravelSection.mutableSegmentPointIds.has(spId) &&
              !this.unravelSection.zLockedSegmentPointIds.has(spId),
          )
          // Change all mutable points (even if not all are mutable, subsequent iterations
          // will handle the rest as transition_via issues)
          if (mutablePoints.length > 0) {
            operations.push({
              type: "change_layer",
              newZ,
              segmentPointIds: mutablePoints,
            })
          }
        }
      }

      // 3. CHANGE LAYER OF CROSSING LINE SEGMENTS (fallback)
      const aSegment = this.dedupedSegmentMap.get(A.segmentId)!
      const bSegment = this.dedupedSegmentMap.get(B.segmentId)!
      const cSegment = this.dedupedSegmentMap.get(C.segmentId)!
      const dSegment = this.dedupedSegmentMap.get(D.segmentId)!

      // Function to check if a new Z level is available for all segments
      const isNewZAvailableForAll = (segmentObjects: any[], newZ: number) => {
        return segmentObjects.every((seg) => seg.availableZ.includes(newZ))
      }

      // Only propose layer changes if both segments can use the target layer
      // and neither point is z-locked
      if (AIsMutable && BIsMutable && !AIsZLocked && !BIsZLocked) {
        const newZ = A.z === 0 ? 1 : 0
        if (isNewZAvailableForAll([aSegment, bSegment], newZ)) {
          operations.push({
            type: "change_layer",
            newZ,
            segmentPointIds: [APointId, BPointId],
          })
        }
      }

      if (CIsMutable && DIsMutable && !CIsZLocked && !DIsZLocked) {
        const newZ = C.z === 0 ? 1 : 0
        if (isNewZAvailableForAll([cSegment, dSegment], newZ)) {
          operations.push({
            type: "change_layer",
            newZ,
            segmentPointIds: [CPointId, DPointId],
          })
        }
      }

      // 3. CHANGE LAYER OF EACH POINT INDIVIDUALLY TO MAKE TRANSITION CROSSING
      if (AIsMutable && !AIsZLocked) {
        const newZ = A.z === 0 ? 1 : 0
        if (aSegment.availableZ.includes(newZ)) {
          operations.push({
            type: "change_layer",
            newZ,
            segmentPointIds: [APointId],
          })
        }
      }

      if (BIsMutable && !BIsZLocked) {
        const newZ = B.z === 0 ? 1 : 0
        if (bSegment.availableZ.includes(newZ)) {
          operations.push({
            type: "change_layer",
            newZ,
            segmentPointIds: [BPointId],
          })
        }
      }

      if (CIsMutable && !CIsZLocked) {
        const newZ = C.z === 0 ? 1 : 0
        if (cSegment.availableZ.includes(newZ)) {
          operations.push({
            type: "change_layer",
            newZ,
            segmentPointIds: [CPointId],
          })
        }
      }

      if (DIsMutable && !DIsZLocked) {
        const newZ = D.z === 0 ? 1 : 0
        if (dSegment.availableZ.includes(newZ)) {
          operations.push({
            type: "change_layer",
            newZ,
            segmentPointIds: [DPointId],
          })
        }
      }
    }

    // TODO single_transition_crossing
    // TODO double_transition_crossing
    // TODO same_layer_trace_imbalance_with_low_capacity

    return operations
  }

  computeG(params: {
    issues: UnravelIssue[]
    originalCandidate: UnravelCandidate
    operationsPerformed: number
    operation: UnravelOperation
  }): number {
    const { issues, originalCandidate, operationsPerformed, operation } = params

    const nodeProblemCounts = new Map<
      CapacityMeshNodeId,
      {
        numTransitionCrossings: number
        numSameLayerCrossings: number
        numEntryExitLayerChanges: number
      }
    >()

    for (const issue of issues) {
      if (!nodeProblemCounts.has(issue.capacityMeshNodeId)) {
        nodeProblemCounts.set(issue.capacityMeshNodeId, {
          numTransitionCrossings: 0,
          numSameLayerCrossings: 0,
          numEntryExitLayerChanges: 0,
        })
      }

      const nodeProblemCount = nodeProblemCounts.get(issue.capacityMeshNodeId)!

      if (issue.type === "transition_via") {
        nodeProblemCount.numTransitionCrossings++
      } else if (issue.type === "same_layer_crossing") {
        nodeProblemCount.numSameLayerCrossings++
      } else if (
        issue.type === "double_transition_crossing" ||
        issue.type === "single_transition_crossing"
      ) {
        nodeProblemCount.numEntryExitLayerChanges++
      } else if (
        issue.type === "same_layer_trace_imbalance_with_low_capacity"
      ) {
        // TODO
      }
    }

    function log1mexp(x: number): number {
      if (x < -Math.LN2) return Math.log(1 - Math.exp(x))
      else return Math.log(-Math.expm1(x)) // more accurate when x ~ 0
    }

    let logSuccess = 0 // log(probability all nodes succeed)

    for (const [
      nodeId,
      {
        numEntryExitLayerChanges,
        numSameLayerCrossings,
        numTransitionCrossings,
      },
    ] of nodeProblemCounts) {
      const node = this.nodeMap.get(nodeId)!
      const estPf = Math.min(
        calculateNodeProbabilityOfFailure(
          node,
          numSameLayerCrossings,
          numEntryExitLayerChanges,
          numTransitionCrossings,
        ),
        0.999999,
      )

      const log1mPf = Math.log(1 - estPf)
      logSuccess += log1mPf
    }

    const logPf = log1mexp(logSuccess)

    return logPf
  }

  getUnexploredNeighborByApplyingOperation(
    currentCandidate: UnravelCandidate,
    operation: UnravelOperation,
  ): UnravelCandidate | null {
    const pointModifications = new Map<
      SegmentPointId,
      { x?: number; y?: number; z?: number }
    >(currentCandidate.pointModifications)

    applyOperationToPointModifications(
      pointModifications,
      operation,
      (segmentPointId) =>
        this.getPointInCandidate(currentCandidate, segmentPointId),
    )

    const candidateHash = createPointModificationsHash(pointModifications)

    if (
      this.queuedOrExploredCandidatePointModificationHashes.has(candidateHash)
    ) {
      return null
    }

    const issues: UnravelIssue[] = getIssuesInSection(
      this.unravelSection,
      this.nodeMap,
      pointModifications,
    )

    const operationsPerformed = currentCandidate.operationsPerformed + 1

    const g = this.computeG({
      issues,
      originalCandidate: currentCandidate,
      operationsPerformed,
      operation,
    })

    return {
      issues,
      g,
      h: 0,
      f: g,
      pointModifications,
      candidateHash,

      // TODO PERFORMANCE allow disabling this
      // candidateFullHash: createFullPointModificationsHash(
      //   this.unravelSection.segmentPointMap,
      //   pointModifications,
      // ),

      operationsPerformed,
    }
  }

  getNeighborOperationsForCandidate(
    candidate: UnravelCandidate,
  ): UnravelOperation[] {
    return candidate.issues.flatMap((issue) =>
      this.getOperationsForIssue(candidate, issue),
    )
  }

  getNeighbors(candidate: UnravelCandidate): UnravelCandidate[] {
    const neighbors: UnravelCandidate[] = []

    const operations = this.getNeighborOperationsForCandidate(candidate)
    for (const operation of operations) {
      const neighbor = this.getUnexploredNeighborByApplyingOperation(
        candidate,
        operation,
      )
      if (!neighbor) continue
      neighbors.push(neighbor)
    }

    return neighbors
  }

  _step() {
    const candidate = this.candidates.shift()
    this.iterationsSinceImprovement++
    if (
      this.iterationsSinceImprovement >
      this.hyperParameters.MAX_ITERATIONS_WITHOUT_IMPROVEMENT
    ) {
      this.solved = true
      return
    }
    if (!candidate) {
      this.solved = true
      return
    }
    this.lastProcessedCandidate = candidate

    if (candidate.f < (this.bestCandidate?.f ?? Infinity)) {
      this.bestCandidate = candidate
      this.iterationsSinceImprovement = 0
      // TODO, only works if we start computing f
      // if (candidate.f <= 0.00001) {
      //   this.solved = true
      //   return
      // }
    }

    this.getNeighbors(candidate).forEach((neighbor) => {
      const isPartialHashExplored =
        this.queuedOrExploredCandidatePointModificationHashes.has(
          neighbor.candidateHash,
        )
      // const isFullHashExplored =
      //   neighbor.candidateFullHash &&
      //   this.queuedOrExploredCandidatePointModificationHashes.has(
      //     neighbor.candidateFullHash,
      //   )

      // if (isPartialHashExplored || isFullHashExplored) return
      if (isPartialHashExplored) return
      this.queuedOrExploredCandidatePointModificationHashes.add(
        neighbor.candidateHash,
      )
      // if (neighbor.candidateFullHash) {
      //   this.queuedOrExploredCandidatePointModificationHashes.add(
      //     neighbor.candidateFullHash,
      //   )
      // }
      this.candidates.push(neighbor)
    })
    this.candidates.sort((a, b) => a.f - b.f)
    this.candidates.length = Math.min(
      this.candidates.length,
      this.MAX_CANDIDATES,
    )
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject &
      Pick<Required<GraphicsObject>, "points" | "lines" | "rects" | "circles"> =
      {
        points: [],
        lines: [],
        rects: [],
        circles: [],
        coordinateSystem: "cartesian",
        title: "Unravel Section Solver",
      }

    // Get the candidate to visualize
    let candidate: UnravelCandidate | null = null
    if (this.selectedCandidateIndex !== null) {
      if (this.selectedCandidateIndex === "best") {
        candidate = this.bestCandidate
      } else if (this.selectedCandidateIndex === "original") {
        candidate = this.originalCandidate
      } else {
        candidate = this.candidates[this.selectedCandidateIndex]
      }
    } else if (this.solved) {
      candidate = this.bestCandidate
    } else {
      candidate = this.lastProcessedCandidate || this.candidates[0]
    }
    if (!candidate) return graphics

    // Create a map of segment points with modifications applied
    const modifiedSegmentPoints = new Map<string, SegmentPoint>()
    for (const [segmentPointId, segmentPoint] of this.unravelSection
      .segmentPointMap) {
      // Create a copy of the original point
      const modifiedPoint = { ...segmentPoint }

      // Apply any modifications from the candidate
      const modification = candidate.pointModifications.get(segmentPointId)
      if (modification) {
        if (modification.x !== undefined) modifiedPoint.x = modification.x
        if (modification.y !== undefined) modifiedPoint.y = modification.y
        if (modification.z !== undefined) modifiedPoint.z = modification.z
      }

      modifiedSegmentPoints.set(segmentPointId, modifiedPoint)
    }

    // Visualize all segment points with modifications applied
    for (const [segmentPointId, segmentPoint] of modifiedSegmentPoints) {
      graphics.points.push({
        x: segmentPoint.x,
        y: segmentPoint.y,
        label: `${segmentPointId}\nSegment: ${segmentPoint.segmentId} ${this.unravelSection.mutableSegmentIds.has(segmentPoint.segmentId) ? "MUTABLE" : "IMMUTABLE"}\nLayer: ${segmentPoint.z}`,
        color: this.colorMap[segmentPoint.connectionName] || "#000",
      })
    }

    // Calculate node stats for the selected candidate
    const nodeStatsMap = new Map<
      CapacityMeshNodeId,
      {
        numTransitionCrossings: number
        numSameLayerCrossings: number
        numEntryExitLayerChanges: number
        estPf: number
      }
    >()

    for (const nodeId of this.unravelSection.allNodeIds) {
      nodeStatsMap.set(nodeId, {
        numTransitionCrossings: 0,
        numSameLayerCrossings: 0,
        numEntryExitLayerChanges: 0,
        estPf: 0,
      })
    }

    for (const issue of candidate.issues) {
      const stats = nodeStatsMap.get(issue.capacityMeshNodeId)!
      if (issue.type === "transition_via") {
        stats.numTransitionCrossings++
      } else if (issue.type === "same_layer_crossing") {
        stats.numSameLayerCrossings++
      } else if (
        issue.type === "double_transition_crossing" ||
        issue.type === "single_transition_crossing"
      ) {
        stats.numEntryExitLayerChanges++
      }
      // TODO: Handle same_layer_trace_imbalance_with_low_capacity if needed for stats
    }

    // Calculate Pf for each node
    for (const [nodeId, stats] of nodeStatsMap.entries()) {
      const node = this.nodeMap.get(nodeId)!
      stats.estPf = calculateNodeProbabilityOfFailure(
        node,
        stats.numSameLayerCrossings,
        stats.numEntryExitLayerChanges,
        stats.numTransitionCrossings,
      )
    }

    // Visualize nodes with stats
    for (const nodeId of this.unravelSection.allNodeIds) {
      const node = this.nodeMap.get(nodeId)!
      const isMutable = this.unravelSection.mutableNodeIds.includes(nodeId)
      const stats = nodeStatsMap.get(nodeId)!

      const label = [
        `${nodeId} (${isMutable ? "MUT" : "IMM"})`,
        `${node.width.toFixed(2)}x${node.height.toFixed(2)}`,
        `Pf: ${stats.estPf.toFixed(3)}`,
        `TC: ${stats.numTransitionCrossings}`, // Transition Crossings (Vias)
        `SLC: ${stats.numSameLayerCrossings}`, // Same Layer Crossings
        `EELC: ${stats.numEntryExitLayerChanges}`, // Entry/Exit Layer Changes
      ].join("\n")

      graphics.rects.push({
        center: node.center,
        label: label,
        color: isMutable ? "green" : "red",
        width: node.width / 8,
        height: node.height / 8,
      })
    }

    // Connect segment points that belong to the same segment
    for (const [segmentId, segmentPointIds] of this.unravelSection
      .segmentPointsInSegment) {
      if (segmentPointIds.length <= 1) continue

      const points = segmentPointIds.map(
        (spId) => modifiedSegmentPoints.get(spId)!,
      )

      // Connect points in order
      for (let i = 0; i < points.length - 1; i++) {
        graphics.lines.push({
          points: [
            { x: points[i].x, y: points[i].y },
            { x: points[i + 1].x, y: points[i + 1].y },
          ],
          strokeColor: this.colorMap[segmentId] || "#000",
        })
      }
    }

    // Connect directly connected segment points (points with the same connection name)
    for (const [segmentPointId, segmentPoint] of modifiedSegmentPoints) {
      for (const connectedPointId of segmentPoint.directlyConnectedSegmentPointIds) {
        // Only process each connection once (when the current point's ID is less than the connected point's ID)
        if (segmentPointId < connectedPointId) {
          const connectedPoint = modifiedSegmentPoints.get(connectedPointId)!
          if (!connectedPoint) continue

          // Determine line style based on layer (z) values
          const sameLayer = segmentPoint.z === connectedPoint.z
          const commonLayer = segmentPoint.z

          let strokeDash: string | undefined
          if (sameLayer) {
            strokeDash = commonLayer === 0 ? undefined : "10 5" // top layer: solid, bottom layer: long dash
          } else {
            strokeDash = "3 3 10" // transition between layers: mixed dash pattern
          }

          graphics.lines.push({
            points: [
              { x: segmentPoint.x, y: segmentPoint.y },
              { x: connectedPoint.x, y: connectedPoint.y },
            ],
            strokeDash,
            strokeColor: this.colorMap[segmentPoint.connectionName] || "#000",
          })
        }
      }
    }

    // Visualize issues
    for (const issue of candidate.issues) {
      const node = this.nodeMap.get(issue.capacityMeshNodeId)!

      if (issue.type === "transition_via") {
        // Highlight via issues
        for (const segmentPointId of issue.segmentPoints) {
          const segmentPoint = modifiedSegmentPoints.get(segmentPointId)!
          graphics.circles.push({
            center: { x: segmentPoint.x, y: segmentPoint.y },
            radius: node.width / 16,
            stroke: "#ff0000",
            fill: "rgba(255, 0, 0, 0.2)",
            label: `Via Issue\n${segmentPointId}\nLayer: ${segmentPoint.z}`,
          })
        }
      } else if (issue.type === "same_layer_crossing") {
        // Highlight crossing issues
        for (const [sp1Id, sp2Id] of [
          issue.crossingLine1,
          issue.crossingLine2,
        ]) {
          const sp1 = modifiedSegmentPoints.get(sp1Id)!
          const sp2 = modifiedSegmentPoints.get(sp2Id)!

          graphics.lines.push({
            points: [
              { x: sp1.x, y: sp1.y },
              { x: sp2.x, y: sp2.y },
            ],
            strokeColor: "rgba(255,0,0,0.2)",
            strokeWidth: node.width / 32,
          })
        }
      }
    }

    // Highlight modified points
    for (const [segmentPointId, modification] of candidate.pointModifications) {
      const modifiedPoint = modifiedSegmentPoints.get(segmentPointId)!
      const originalPoint =
        this.unravelSection.segmentPointMap.get(segmentPointId)!

      graphics.circles.push({
        center: { x: modifiedPoint.x, y: modifiedPoint.y },
        radius: 0.05,
        stroke: "#0000ff",
        fill: "rgba(0, 0, 255, 0.2)",
        label: `${segmentPointId}\nOriginal: (${originalPoint.x.toFixed(2)}, ${originalPoint.y.toFixed(2)}, ${originalPoint.z})\nNew: (${modifiedPoint.x.toFixed(2)}, ${modifiedPoint.y.toFixed(2)}, ${modifiedPoint.z})`,
      })
    }

    return graphics
  }
}
