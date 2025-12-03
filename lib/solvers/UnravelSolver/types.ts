import type { CapacityMeshNodeId } from "lib/types"

export type SegmentPointId = string
export type SegmentId = string

export interface BaseUnravelIssue {
  probabilityOfFailure: number
}

export interface UnravelTransitionViaIssue extends BaseUnravelIssue {
  type: "transition_via"
  capacityMeshNodeId: CapacityMeshNodeId
  segmentPoints: SegmentPointId[]
}

export interface UnravelSameLayerCrossingIssue extends BaseUnravelIssue {
  type: "same_layer_crossing"
  capacityMeshNodeId: CapacityMeshNodeId
  crossingLine1: [SegmentPointId, SegmentPointId]
  crossingLine2: [SegmentPointId, SegmentPointId]
}

export interface UnravelSingleTransitionCrossingIssue extends BaseUnravelIssue {
  type: "single_transition_crossing"
  capacityMeshNodeId: CapacityMeshNodeId
  sameLayerCrossingLine: [SegmentPointId, SegmentPointId]
  transitionCrossingLine: [SegmentPointId, SegmentPointId]
}

export interface UnravelDoubleTransitionCrossingIssue extends BaseUnravelIssue {
  type: "double_transition_crossing"
  capacityMeshNodeId: CapacityMeshNodeId
  crossingLine1: [SegmentPointId, SegmentPointId]
  crossingLine2: [SegmentPointId, SegmentPointId]
}

export interface UnravelTraceCapacityIssue extends BaseUnravelIssue {
  type: "same_layer_trace_imbalance_with_low_capacity"
  capacityMeshNodeId: CapacityMeshNodeId
  z: number
  tracesOnLayer: Array<{ A: SegmentPointId; B: SegmentPointId }>
}

export interface SegmentPoint {
  segmentPointId: SegmentPointId
  directlyConnectedSegmentPointIds: SegmentPointId[]
  connectionName: string
  segmentId: string
  capacityMeshNodeIds: CapacityMeshNodeId[]
  x: number
  y: number
  z: number
}

export type SegmentPointMap = Map<SegmentPointId, SegmentPoint>

export type UnravelIssue =
  | UnravelTransitionViaIssue
  | UnravelSameLayerCrossingIssue
  | UnravelSingleTransitionCrossingIssue
  | UnravelDoubleTransitionCrossingIssue
  | UnravelTraceCapacityIssue

export interface UnravelSection {
  allNodeIds: CapacityMeshNodeId[]
  mutableNodeIds: CapacityMeshNodeId[]
  mutableSegmentIds: Set<string>
  immutableNodeIds: CapacityMeshNodeId[]
  segmentPointMap: SegmentPointMap
  mutableSegmentPointIds: Set<SegmentPointId>
  zLockedSegmentPointIds: Set<SegmentPointId>
  segmentPairsInNode: Map<
    CapacityMeshNodeId,
    Array<[SegmentPointId, SegmentPointId]>
  >
  segmentPointsInNode: Map<CapacityMeshNodeId, SegmentPointId[]>
  segmentPointsInSegment: Map<SegmentId, SegmentPointId[]>
  originalPointMap: Map<SegmentPointId, { x: number; y: number; z: number }>
}

export interface UnravelChangeLayerOperation {
  type: "change_layer"
  newZ: number
  segmentPointIds: SegmentPointId[]
}

export interface UnravelSwapPositionOnSegmentOperation {
  type: "swap_position_on_segment"
  segmentPointIds: SegmentPointId[]
}

export interface UnravelCombinedOperation {
  type: "combined"
  operations: Array<
    UnravelChangeLayerOperation | UnravelSwapPositionOnSegmentOperation
  >
}

export type UnravelOperation =
  | UnravelChangeLayerOperation
  | UnravelSwapPositionOnSegmentOperation
  | UnravelCombinedOperation

export type PointModificationsMap = Map<
  SegmentPointId,
  {
    x?: number
    y?: number
    z?: number
  }
>

export type UnravelCandidate = {
  operationsPerformed: number

  /**
   * A hash of the pointModifications to know if this candidate has already been
   * explored
   */
  candidateHash: string

  /**
   * More expensive hash that includes original positions
   */
  candidateFullHash?: string

  pointModifications: Map<
    SegmentPointId,
    {
      x?: number
      y?: number
      z?: number
    }
  >

  issues: UnravelIssue[]

  /**
   * The cost of this candidate (log probability of failure) considering all of
   * the point modifications
   */
  g: number

  /**
   * The estimated cost of this candidate (log probability of failure). We don't
   * currently know how to compute this so it's always 0.
   */
  h: number

  /**
   * Candidate cost ~(g + h)
   */
  f: number
}
