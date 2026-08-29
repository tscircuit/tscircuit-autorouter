import { negotiateBoundaryContracts } from "./boundary-contract-negotiator"
import { buildHybridWorkerBoardContext, buildRegionJob } from "./build-worker-messages"
import { finalizeCoupledRoutes } from "./coupled-route-finalizer"
import { DemandCapacityField } from "./demand-capacity-field"
import { createDeterministicRegionSchedule } from "./deterministic-region-scheduler"
import { DynamicRegionGraph } from "./dynamic-region-graph"
import { planGlobalTopology } from "./global-topology-planner"
import { executeRegionJob } from "./execute-region-job"
import type { HybridRoutingCoreRuntime } from "./rust-core-protocol"
import type {
  SerialHybridEngineArtifacts,
  SerialHybridEngineResult,
} from "./serial-engine-types"
import { TransactionalCopperStore } from "./transactional-copper-store"
import type {
  HybridCopperSnapshot,
  HybridTransactionDelta,
} from "./transactional-copper-types"
import type { TypedRoutingProblem } from "./types"
import type {
  DynamicRoutingRegion,
  GlobalRouteObjectPlan,
  HybridBoundaryContract,
  RegionAttemptRecord,
} from "./planning-types"

export type SerialHybridEngineConfiguration = {
  readonly runtime: HybridRoutingCoreRuntime
  readonly deterministicSeed: number
  readonly maximumSearchExpansions: number
  readonly maximumActivationRings: number
  readonly maximumTransactionHistory: number
  readonly maximumDemandCellCount: number
  readonly maximumRegionCount: number
  readonly maximumRegionMutationCount: number
  readonly maximumMergeRegionCount: number
  readonly maximumEstimatedMemoryBytesPerObject: number
  readonly maximumWaveMemoryBytes: number
}

export async function runSerialHybridTransactionalEngine({
  problem,
  configuration,
}: {
  problem: TypedRoutingProblem
  configuration: SerialHybridEngineConfiguration
}): Promise<SerialHybridEngineResult> {
  validateConfiguration(configuration)
  const topologyPlan = planGlobalTopology({
    problem,
    maximumEstimatedMemoryBytesPerObject:
      configuration.maximumEstimatedMemoryBytesPerObject,
  })
  const copperStore = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: configuration.maximumTransactionHistory,
  })
  const demandField = new DemandCapacityField({
    problem,
    topologyPlan,
    copperSnapshot: copperStore.getSnapshot(),
    maximumCellCount: configuration.maximumDemandCellCount,
  })
  const dynamicRegionGraph = new DynamicRegionGraph({
    problem,
    topologyPlan,
    maximumRegionCount: configuration.maximumRegionCount,
    maximumMutationCount: configuration.maximumRegionMutationCount,
    maximumMergeRegionCount: configuration.maximumMergeRegionCount,
  })
  const regionGraph = dynamicRegionGraph.getSnapshot()
  const boundaryContracts = negotiateBoundaryContracts({
    problem,
    topologyPlan,
    regionGraph,
  })
  copperStore.setBoundaryContractVersion(regionGraph.graphVersion)
  const schedule = createDeterministicRegionSchedule({
    regionGraph,
    maximumConcurrency: 1,
    maximumWaveMemoryBytes: configuration.maximumWaveMemoryBytes,
  })
  const attempts: RegionAttemptRecord[] = []
  const scheduledRegionIds = schedule.flatMap((wave) =>
    wave.regions.map((scheduled) => scheduled.regionId),
  )
  for (const [scheduledIndex, regionId] of scheduledRegionIds.entries()) {
    const region = regionGraph.regions.find(
      (candidate) => candidate.regionId === regionId,
    )
    if (!region) {
      return createFailedResult({
        topologyPlan,
        demandField,
        regionGraph,
        boundaryContracts,
        copperStore,
        attempts,
        message: `schedule references missing region ${regionId}`,
      })
    }
    for (const routeObjectId of region.routeObjectIds) {
      const routePlan = topologyPlan.routeObjectPlans.find(
        (candidate) => candidate.routeObjectId === routeObjectId,
      )
      if (!routePlan) {
        return createFailedResult({
          topologyPlan,
          demandField,
          regionGraph,
          boundaryContracts,
          copperStore,
          attempts,
          failedRegionId: regionId,
          message: `region references missing route plan ${routeObjectId}`,
        })
      }
      const attemptStart = performance.now()
      let candidate: RegionCandidateResult
      try {
        candidate = await routeRegionPlan({
          problem,
          routePlan,
          region,
          boundaryContracts,
          copperSnapshot: copperStore.getSnapshot(),
          configuration,
        })
      } catch (error) {
        attempts.push(
          createAttempt({
            region,
            routePlan,
            attemptIndex: attempts.length,
            solveTimeMs: performance.now() - attemptStart,
            outcome: "failed",
            rejectionReason: getErrorMessage(error),
          }),
        )
        return createFailedResult({
          topologyPlan,
          demandField,
          regionGraph,
          boundaryContracts,
          copperStore,
          attempts,
          failedRegionId: regionId,
          message: getErrorMessage(error),
        })
      }
      if (candidate.status === "failed") {
        attempts.push(
          createAttempt({
            region,
            routePlan,
            attemptIndex: attempts.length,
            solveTimeMs: performance.now() - attemptStart,
            outcome: "failed",
            rejectionReason: candidate.message,
          }),
        )
        return createIncompleteResult({
          topologyPlan,
          demandField,
          regionGraph,
          boundaryContracts,
          copperStore,
          attempts,
          failedRegionId: regionId,
          unresolvedRegionIds: scheduledRegionIds.slice(scheduledIndex),
          message: candidate.message,
        })
      }
      const commit = copperStore.commit(candidate.delta)
      if (commit.status !== "committed") {
        attempts.push(
          createAttempt({
            region,
            routePlan,
            attemptIndex: attempts.length,
            solveTimeMs: performance.now() - attemptStart,
            outcome: "rejected",
            rejectionReason: commit.rejection.message,
            transactionId: candidate.delta.transactionId,
          }),
        )
        return createIncompleteResult({
          topologyPlan,
          demandField,
          regionGraph,
          boundaryContracts,
          copperStore,
          attempts,
          failedRegionId: regionId,
          unresolvedRegionIds: scheduledRegionIds.slice(scheduledIndex),
          rejection: commit.rejection,
          message: commit.rejection.message,
        })
      }
      demandField.applyCommittedTransaction({
        delta: candidate.delta,
        committedSnapshot: commit.snapshot,
      })
      attempts.push(
        createAttempt({
          region,
          routePlan,
          attemptIndex: attempts.length,
          solveTimeMs: performance.now() - attemptStart,
          outcome: "committed",
          transactionId: candidate.delta.transactionId,
        }),
      )
    }
  }
  const finalization = finalizeCoupledRoutes({ problem, copperStore })
  for (const record of finalization.records) {
    demandField.applyCommittedTransaction({
      delta: record.delta,
      committedSnapshot: record.committedSnapshot,
    })
    attempts.push(createFinalizationAttempt(record.delta))
  }
  if (finalization.status === "failed") {
    return createIncompleteResult({
      topologyPlan,
      demandField,
      regionGraph,
      boundaryContracts,
      copperStore,
      attempts,
      failedRegionId: "coupled-route-finalization",
      unresolvedRegionIds: Object.freeze([]),
      rejection: finalization.rejection,
      message: finalization.message,
    })
  }
  return Object.freeze({
    status: "routed",
    artifacts: createArtifacts({
      topologyPlan,
      demandField,
      regionGraph,
      boundaryContracts,
      copperStore,
      attempts,
    }),
  })
}

function createFinalizationAttempt(
  delta: HybridTransactionDelta,
): RegionAttemptRecord {
  return Object.freeze({
    attemptId: `finalization-attempt:${delta.transactionId}`,
    regionId: delta.regionId,
    workerId: "control-plane",
    strategy: "transactional-coupled-finalization",
    queueWaitMs: 0,
    solveTimeMs: 0,
    workerCpuMs: 0,
    transferredBytes: 0,
    returnedBytes: 0,
    outcome: "committed",
    transactionId: delta.transactionId,
  })
}

type RegionCandidateResult =
  | { readonly status: "candidate"; readonly delta: HybridTransactionDelta }
  | { readonly status: "failed"; readonly message: string }

async function routeRegionPlan({
  problem,
  routePlan,
  region,
  boundaryContracts,
  copperSnapshot,
  configuration,
}: {
  problem: TypedRoutingProblem
  routePlan: GlobalRouteObjectPlan
  region: DynamicRoutingRegion
  boundaryContracts: readonly HybridBoundaryContract[]
  copperSnapshot: HybridCopperSnapshot
  configuration: SerialHybridEngineConfiguration
}): Promise<RegionCandidateResult> {
  const execution = await executeRegionJob({
    context: buildHybridWorkerBoardContext({
      problem,
      copperSnapshot,
      contextId: `serial-context:${copperSnapshot.version}`,
      boardContextVersion: 0,
    }),
    job: buildRegionJob({
      problem,
      routePlan,
      region,
      boundaryContracts,
      copperSnapshot,
      maximumExpansions: configuration.maximumSearchExpansions,
      maximumActivationRings: configuration.maximumActivationRings,
      deterministicSeed: configuration.deterministicSeed,
    }),
    runtime: configuration.runtime,
  })
  return execution.status === "candidate"
    ? { status: "candidate", delta: execution.transactionDelta }
    : { status: "failed", message: execution.message }
}

function createAttempt({
  region,
  routePlan,
  attemptIndex,
  solveTimeMs,
  outcome,
  rejectionReason,
  transactionId,
}: {
  region: DynamicRoutingRegion
  routePlan: GlobalRouteObjectPlan
  attemptIndex: number
  solveTimeMs: number
  outcome: RegionAttemptRecord["outcome"]
  rejectionReason?: string
  transactionId?: string
}): RegionAttemptRecord {
  return Object.freeze({
    attemptId: `serial-attempt:${attemptIndex}:${region.regionId}:${routePlan.routeObjectId}`,
    regionId: region.regionId,
    workerId: "serial-control-plane",
    strategy: "rust-deterministic-grid-search",
    queueWaitMs: 0,
    solveTimeMs,
    workerCpuMs: solveTimeMs,
    transferredBytes: 0,
    returnedBytes: 0,
    outcome,
    rejectionReason,
    transactionId,
  })
}

function createArtifacts({
  topologyPlan,
  demandField,
  regionGraph,
  boundaryContracts,
  copperStore,
  attempts,
}: {
  topologyPlan: SerialHybridEngineArtifacts["topologyPlan"]
  demandField: DemandCapacityField
  regionGraph: SerialHybridEngineArtifacts["regionGraph"]
  boundaryContracts: SerialHybridEngineArtifacts["boundaryContracts"]
  copperStore: TransactionalCopperStore
  attempts: readonly RegionAttemptRecord[]
}): SerialHybridEngineArtifacts {
  return Object.freeze({
    topologyPlan,
    demandCapacityField: demandField.getSnapshot(),
    regionGraph,
    boundaryContracts,
    copperSnapshot: copperStore.getSnapshot(),
    attempts: Object.freeze([...attempts]),
  })
}

function createIncompleteResult({
  topologyPlan,
  demandField,
  regionGraph,
  boundaryContracts,
  copperStore,
  attempts,
  unresolvedRegionIds,
  rejection,
  message,
}: ParametersForIncompleteResult): SerialHybridEngineResult {
  const artifacts = createArtifacts({
    topologyPlan,
    demandField,
    regionGraph,
    boundaryContracts,
    copperStore,
    attempts,
  })
  if (artifacts.copperSnapshot.version === 0) {
    return Object.freeze({ status: "failed", artifacts, message })
  }
  return Object.freeze({
    status: "partial",
    artifacts,
    unresolvedRegionIds: Object.freeze([...unresolvedRegionIds]),
    rejection,
    message,
  })
}

type ParametersForIncompleteResult = {
  topologyPlan: SerialHybridEngineArtifacts["topologyPlan"]
  demandField: DemandCapacityField
  regionGraph: SerialHybridEngineArtifacts["regionGraph"]
  boundaryContracts: SerialHybridEngineArtifacts["boundaryContracts"]
  copperStore: TransactionalCopperStore
  attempts: readonly RegionAttemptRecord[]
  failedRegionId: string
  unresolvedRegionIds: readonly string[]
  rejection?: Extract<SerialHybridEngineResult, { status: "partial" }>["rejection"]
  message: string
}

function createFailedResult({
  topologyPlan,
  demandField,
  regionGraph,
  boundaryContracts,
  copperStore,
  attempts,
  failedRegionId,
  message,
}: {
  topologyPlan: SerialHybridEngineArtifacts["topologyPlan"]
  demandField: DemandCapacityField
  regionGraph: SerialHybridEngineArtifacts["regionGraph"]
  boundaryContracts: SerialHybridEngineArtifacts["boundaryContracts"]
  copperStore: TransactionalCopperStore
  attempts: readonly RegionAttemptRecord[]
  failedRegionId?: string
  message: string
}): SerialHybridEngineResult {
  return Object.freeze({
    status: "failed",
    artifacts: createArtifacts({
      topologyPlan,
      demandField,
      regionGraph,
      boundaryContracts,
      copperStore,
      attempts,
    }),
    failedRegionId,
    message,
  })
}

function validateConfiguration(
  configuration: SerialHybridEngineConfiguration,
): void {
  const positiveIntegerValues = [
    configuration.maximumSearchExpansions,
    configuration.maximumActivationRings,
    configuration.maximumTransactionHistory,
    configuration.maximumDemandCellCount,
    configuration.maximumRegionCount,
    configuration.maximumRegionMutationCount,
    configuration.maximumMergeRegionCount,
    configuration.maximumEstimatedMemoryBytesPerObject,
    configuration.maximumWaveMemoryBytes,
  ]
  if (
    positiveIntegerValues.some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    ) ||
    !Number.isSafeInteger(configuration.deterministicSeed) ||
    configuration.deterministicSeed < 0
  ) {
    throw new Error("serial hybrid engine configuration contains an invalid bound")
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
