import type {
  ConnectionName,
  HybridBoardBounds,
  HybridRouterDiagnostic,
  LayerName,
  RouteObjectId,
  TerminalId,
} from "./types"

export type CopperVersion = number
export type BoundaryContractVersion = number
export type HybridCopperId = string
export type HybridTransactionId = string

export type HybridCopperPoint = {
  readonly x: number
  readonly y: number
}

export type HybridCopperOwnership =
  | {
      readonly mutability: "immutable"
      readonly ownerRouteObjectIds: readonly []
    }
  | {
      readonly mutability: "mutable"
      readonly ownerRouteObjectIds: readonly RouteObjectId[]
    }

export type HybridCopperSegment = {
  readonly kind: "segment"
  readonly copperId: HybridCopperId
  readonly connectionName: ConnectionName
  readonly layer: LayerName
  readonly start: HybridCopperPoint
  readonly end: HybridCopperPoint
  readonly widthMm: number
  readonly ownership: HybridCopperOwnership
}

export type HybridCopperVia = {
  readonly kind: "via"
  readonly copperId: HybridCopperId
  readonly connectionName: ConnectionName
  readonly x: number
  readonly y: number
  readonly fromLayer: LayerName
  readonly toLayer: LayerName
  readonly padDiameterMm: number
  readonly holeDiameterMm: number
  readonly ownership: HybridCopperOwnership
}

export type HybridCopperPrimitive = HybridCopperSegment | HybridCopperVia

export type HybridConnectivityEffects = {
  readonly connectionNames: readonly ConnectionName[]
  readonly connectedTerminalIds: readonly TerminalId[]
}

export type HybridCandidateCost = {
  readonly viaCount: number
  readonly totalLengthMm: number
  readonly bendCount: number
  readonly congestionCost: number
  readonly softViaBudgetExceeded: boolean
  readonly softViaBudgetJustification?: string
}

export type HybridTransactionWorkCounters = {
  readonly searchExpansions: number
  readonly spatialIndexQueries: number
  readonly drcPredicateCalls: number
  readonly geometryAllocations: number
}

export type HybridTransactionDelta = {
  readonly transactionId: HybridTransactionId
  readonly regionId: string
  readonly ownerRouteObjectId: RouteObjectId
  readonly baseCopperVersion: CopperVersion
  readonly boundaryContractVersion: BoundaryContractVersion
  readonly addedTraces: readonly HybridCopperSegment[]
  readonly removedOwnedTraceIds: readonly HybridCopperId[]
  readonly addedVias: readonly HybridCopperVia[]
  readonly removedOwnedViaIds: readonly HybridCopperId[]
  readonly connectivityEffects: HybridConnectivityEffects
  readonly affectedBounds: HybridBoardBounds
  readonly candidateCost: HybridCandidateCost
  readonly work: HybridTransactionWorkCounters
  readonly diagnostic: HybridRouterDiagnostic
}

export type TransactionRejectionCode =
  | "invalid_delta"
  | "stale_conflict"
  | "ownership_violation"
  | "duplicate_copper_id"
  | "unknown_connection"
  | "illegal_layer"
  | "illegal_via_span"
  | "via_budget_exceeded"
  | "trace_width_violation"
  | "via_dimension_violation"
  | "outside_board_outline"
  | "obstacle_clearance_violation"
  | "copper_clearance_violation"
  | "unintended_connectivity"
  | "terminal_connectivity_violation"
  | "boundary_contract_mismatch"

export type TransactionRejection = {
  readonly code: TransactionRejectionCode
  readonly message: string
  readonly transactionId: HybridTransactionId
  readonly conflictingCopperIds: readonly HybridCopperId[]
  readonly connectionNames: readonly ConnectionName[]
}

export type AcceptedTransactionValidation = {
  readonly status: "accepted"
  readonly transactionId: HybridTransactionId
  readonly validatedAtCopperVersion: CopperVersion
  readonly wasStaleRevalidation: boolean
  readonly spatialIndexQueries: number
  readonly drcPredicateCalls: number
}

export type RejectedTransactionValidation = {
  readonly status: "rejected"
  readonly rejection: TransactionRejection
  readonly validatedAtCopperVersion: CopperVersion
  readonly wasStaleRevalidation: boolean
  readonly spatialIndexQueries: number
  readonly drcPredicateCalls: number
}

export type TransactionValidationResult =
  | AcceptedTransactionValidation
  | RejectedTransactionValidation

export type HybridCopperSnapshot = {
  readonly version: CopperVersion
  readonly segments: readonly HybridCopperSegment[]
  readonly vias: readonly HybridCopperVia[]
}

export type CommittedHybridTransaction = {
  readonly transactionId: HybridTransactionId
  readonly regionId: string
  readonly committedVersion: CopperVersion
  readonly baseCopperVersion: CopperVersion
  readonly wasStaleRevalidation: boolean
  readonly candidateCost: HybridCandidateCost
}

export type HybridTransactionCommitResult =
  | {
      readonly status: "committed"
      readonly transaction: CommittedHybridTransaction
      readonly snapshot: HybridCopperSnapshot
    }
  | RejectedTransactionValidation
