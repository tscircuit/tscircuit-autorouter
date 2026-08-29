import type {
  HybridCoreGeometry,
  HybridCoreRoutePoint,
} from "./rust-core-protocol"
import type {
  HybridBoardBounds,
  HybridRouterDiagnostic,
  LayerName,
  RouteObjectId,
  TerminalId,
} from "./types"
import type {
  CopperVersion,
  HybridCopperId,
  HybridTransactionDelta,
} from "./transactional-copper-types"

export const HYBRID_WORKER_PROTOCOL_VERSION = 1 as const

export type HybridWorkerGeometry = {
  readonly geometry: HybridCoreGeometry
  readonly connectedConnectionNames: readonly string[]
}

export type HybridWorkerConnectionRule = {
  readonly connectionName: string
  readonly traceWidthMm: number
  readonly allowedLayers: readonly LayerName[]
  readonly viaSoftMaximum: number
  readonly viaHardMaximum: number
}

export type HybridWorkerBoardContext = {
  readonly protocolVersion: typeof HYBRID_WORKER_PROTOCOL_VERSION
  readonly contextId: string
  readonly boardContextVersion: number
  readonly copperVersion: CopperVersion
  readonly boardBounds: HybridBoardBounds
  readonly layerNames: readonly LayerName[]
  readonly legalViaSpans: readonly {
    readonly fromLayer: LayerName
    readonly toLayer: LayerName
  }[]
  readonly viaPadDiameterMm: number
  readonly viaHoleDiameterMm: number
  readonly clearanceMm: number
  readonly geometry: readonly HybridWorkerGeometry[]
  readonly connectionRules: readonly HybridWorkerConnectionRule[]
}

export type RegionSearchSpec = {
  readonly searchId: string
  readonly connectionRuleReference: string
  readonly start: HybridCoreRoutePoint
  readonly goal: HybridCoreRoutePoint
  readonly connectedTerminalIds: readonly TerminalId[]
  readonly remainingViaBudget: number
}

export type RegionJobCoupling =
  | { readonly kind: "independent" }
  | {
      readonly kind: "differential_pair"
      readonly orderedConnectionNames: readonly [string, string]
      readonly adjacentEdgeGapsMm: readonly [number]
      readonly maximumSkewMm: number
      readonly maximumUncoupledLengthMm: number
    }
  | {
      readonly kind: "bus"
      readonly busId: string
      readonly orderedConnectionNames: readonly string[]
      readonly adjacentEdgeGapsMm: readonly number[]
      readonly maximumSkewMm: number
    }
  | {
      readonly kind: "power"
      readonly connectionName: string
      readonly topology: "point_to_point" | "tree" | "mesh"
    }

export type RegionJob = {
  readonly protocolVersion: typeof HYBRID_WORKER_PROTOCOL_VERSION
  readonly jobId: string
  readonly regionId: string
  readonly transactionId: string
  readonly ownerRouteObjectId: RouteObjectId
  readonly boardContextVersion: number
  readonly copperVersion: CopperVersion
  readonly boundaryContractVersion: number
  readonly bounds: HybridBoardBounds
  readonly envelope: HybridBoardBounds
  readonly terminalReferences: readonly TerminalId[]
  readonly boundaryContractReferences: readonly string[]
  readonly ownedPreloadedCopperReferences: readonly HybridCopperId[]
  readonly searches: readonly RegionSearchSpec[]
  readonly coupling: RegionJobCoupling
  readonly solverBudget: {
    readonly maximumExpansions: number
    readonly maximumActivationRings: number
  }
  readonly routingResolutionMm: number
  readonly deterministicSeed: number
  readonly congestionCost: number
  readonly diagnostic: HybridRouterDiagnostic
}

export type HybridWorkerCopperUpdate = {
  readonly baseCopperVersion: CopperVersion
  readonly nextCopperVersion: CopperVersion
  readonly removedGeometryIds: readonly string[]
  readonly addedGeometry: readonly HybridWorkerGeometry[]
}

export type HybridWorkerRequest =
  | {
      readonly type: "initialize"
      readonly context: HybridWorkerBoardContext
    }
  | { readonly type: "run"; readonly job: RegionJob }
  | {
      readonly type: "apply_copper_update"
      readonly update: HybridWorkerCopperUpdate
    }
  | { readonly type: "shutdown" }

export type HybridWorkerResponse =
  | {
      readonly type: "initialized"
      readonly workerId: string
      readonly contextId: string
    }
  | {
      readonly type: "result"
      readonly workerId: string
      readonly jobId: string
      readonly transactionDelta: HybridTransactionDelta
      readonly solveTimeMs: number
      readonly cpuTimeMs: number
      readonly receivedBytes: number
      readonly returnedBytes: number
    }
  | {
      readonly type: "job_failed"
      readonly workerId: string
      readonly jobId: string
      readonly code:
        | "context_not_initialized"
        | "stale_board_context"
        | "stale_copper_version"
        | "unknown_rule_reference"
        | "core_search_failed"
        | "runtime_failure"
      readonly message: string
      readonly solveTimeMs: number
      readonly cpuTimeMs: number
    }
  | {
      readonly type: "copper_updated"
      readonly workerId: string
      readonly copperVersion: CopperVersion
    }

export type HybridWorkerRuntimeConfiguration = {
  readonly workerId: string
  readonly target: "native" | "wasm"
  readonly runtimeModulePath: string
}
