import type {
  ConnectionName,
  HybridBoardBounds,
  HybridBoardPoint,
  LayerName,
  RouteObjectId,
  TypedRouteObject,
} from "./types"
import type { CopperVersion, HybridTransactionId } from "./transactional-copper-types"

export type HybridTopologyKind =
  | "direct"
  | "chain"
  | "tree"
  | "mesh"
  | "coupled_parallel"

export type PlannedRoutingCorridor = {
  readonly corridorId: string
  readonly connectionName: ConnectionName
  readonly start: HybridBoardPoint
  readonly end: HybridBoardPoint
  readonly preferredLayer: LayerName
  readonly widthReserveMm: number
  readonly estimatedLengthMm: number
  readonly congestionPressure: number
  readonly immutableCopperPressure: number
  readonly approximateLayerTransitions: number
  readonly bounds: HybridBoardBounds
}

export type GlobalRouteObjectPlan = {
  readonly routeObjectId: RouteObjectId
  readonly routeObjectKind: TypedRouteObject["kind"]
  readonly topology: HybridTopologyKind
  readonly connectionNames: readonly ConnectionName[]
  readonly preferredLayers: readonly LayerName[]
  readonly corridors: readonly PlannedRoutingCorridor[]
  readonly coupledEnvelopeReserveMm: number
  readonly estimatedSolverWork: number
  readonly estimatedMemoryBytes: number
  readonly criticality: number
}

export type GlobalTopologyPlan = {
  readonly planVersion: number
  readonly routeObjectPlans: readonly GlobalRouteObjectPlan[]
}

export type DemandCapacityCell = {
  readonly layer: LayerName
  readonly column: number
  readonly row: number
  readonly bounds: HybridBoardBounds
  readonly capacity: number
  readonly demand: number
  readonly committedCopperDemand: number
  readonly obstaclePressure: number
  readonly directionPenalty: number
}

export type DemandCapacityFieldSnapshot = {
  readonly version: CopperVersion
  readonly cellSizeMm: number
  readonly columnCount: number
  readonly rowCount: number
  readonly cells: readonly DemandCapacityCell[]
}

export type DynamicRoutingRegion = {
  readonly regionId: string
  readonly routeObjectIds: readonly RouteObjectId[]
  readonly connectionNames: readonly ConnectionName[]
  readonly ownedPreloadedCopperIds: readonly string[]
  readonly bounds: HybridBoardBounds
  readonly maximumEnvelope: HybridBoardBounds
  readonly overlapReserveMm: number
  readonly neighboringRegionIds: readonly string[]
  readonly dependencyRegionIds: readonly string[]
  readonly conflictRegionIds: readonly string[]
  readonly criticality: number
  readonly congestionPressure: number
  readonly estimatedSolverWork: number
  readonly estimatedMemoryBytes: number
  readonly mutationGeneration: number
}

export type DynamicRegionGraphSnapshot = {
  readonly graphVersion: number
  readonly regions: readonly DynamicRoutingRegion[]
  readonly splitCount: number
  readonly mergeCount: number
}

export type BoundaryCrossing = {
  readonly connectionName: ConnectionName
  readonly ownerRouteObjectId: RouteObjectId
  readonly order: number
  readonly permittedLayers: readonly LayerName[]
  readonly entryDirection: "horizontal" | "vertical" | "any"
  readonly grouping: "single" | "differential_pair" | "bus" | "power"
}

export type HybridBoundaryContract = {
  readonly contractId: string
  readonly firstRegionId: string
  readonly secondRegionId: string
  readonly version: number
  readonly crossingEnvelope: HybridBoardBounds
  readonly legalReserveMm: number
  readonly crossings: readonly BoundaryCrossing[]
}

export type ScheduledRegion = {
  readonly regionId: string
  readonly priority: number
  readonly color: number
  readonly estimatedSolverWork: number
  readonly estimatedMemoryBytes: number
}

export type DeterministicScheduleWave = {
  readonly waveIndex: number
  readonly regions: readonly ScheduledRegion[]
}

export type RegionAttemptRecord = {
  readonly attemptId: string
  readonly regionId: string
  readonly workerId: string
  readonly strategy: string
  readonly queueWaitMs: number
  readonly solveTimeMs: number
  readonly workerCpuMs: number
  readonly transferredBytes: number
  readonly returnedBytes: number
  readonly outcome: "candidate" | "committed" | "rejected" | "failed" | "cancelled"
  readonly rejectionReason?: string
  readonly transactionId?: HybridTransactionId
}
