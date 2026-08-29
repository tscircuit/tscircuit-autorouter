import type { DemandCapacityFieldSnapshot, DynamicRegionGraphSnapshot, GlobalTopologyPlan, HybridBoundaryContract, RegionAttemptRecord } from "./planning-types"
import type { HybridCopperSnapshot, TransactionRejection } from "./transactional-copper-types"
import type { VerifiedFinalBoard } from "./final-board-verifier"
import type { RegionCacheSnapshot } from "./content-addressed-region-cache"

export type SerialHybridEngineArtifacts = {
  readonly topologyPlan: GlobalTopologyPlan
  readonly demandCapacityField: DemandCapacityFieldSnapshot
  readonly regionGraph: DynamicRegionGraphSnapshot
  readonly boundaryContracts: readonly HybridBoundaryContract[]
  readonly copperSnapshot: HybridCopperSnapshot
  readonly attempts: readonly RegionAttemptRecord[]
  readonly cache: RegionCacheSnapshot
}

export type SerialHybridEngineResult =
  | {
      readonly status: "routed"
      readonly artifacts: SerialHybridEngineArtifacts
      readonly verification: VerifiedFinalBoard
    }
  | {
      readonly status: "partial"
      readonly artifacts: SerialHybridEngineArtifacts
      readonly unresolvedRegionIds: readonly string[]
      readonly rejection?: TransactionRejection
      readonly message: string
    }
  | {
      readonly status: "failed"
      readonly artifacts: SerialHybridEngineArtifacts
      readonly failedRegionId?: string
      readonly message: string
    }
