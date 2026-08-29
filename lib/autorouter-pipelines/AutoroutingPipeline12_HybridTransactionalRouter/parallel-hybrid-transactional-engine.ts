import { negotiateBoundaryContracts } from "./boundary-contract-negotiator"
import { finalizeCoupledRoutes } from "./coupled-route-finalizer"
import {
  buildHybridWorkerBoardContext,
  buildRegionJob,
  buildWorkerCopperUpdate,
} from "./build-worker-messages"
import { DemandCapacityField } from "./demand-capacity-field"
import { createDeterministicRegionSchedule } from "./deterministic-region-scheduler"
import { DynamicRegionGraph } from "./dynamic-region-graph"
import { planGlobalTopology } from "./global-topology-planner"
import type {
  DynamicRoutingRegion,
  GlobalRouteObjectPlan,
  RegionAttemptRecord,
} from "./planning-types"
import type {
  SerialHybridEngineArtifacts,
  SerialHybridEngineResult,
} from "./serial-engine-types"
import { TransactionalCopperStore } from "./transactional-copper-store"
import type { TypedRoutingProblem } from "./types"
import type { HybridTransactionDelta } from "./transactional-copper-types"
import { HybridRoutingWorkerPool } from "./worker-pool"
import type { HybridWorkerPoolJobResult } from "./worker-pool"

export type ParallelHybridEngineConfiguration = {
  readonly workerEntryPath: string
  readonly runtimeTarget: "native" | "wasm"
  readonly runtimeModulePath: string
  readonly maximumConcurrency: number
  readonly maximumWorkerQueueLength: number
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

type ScheduledJobResult = {
  readonly region: DynamicRoutingRegion
  readonly routePlan: GlobalRouteObjectPlan
  readonly result: HybridWorkerPoolJobResult
}

export async function runParallelHybridTransactionalEngine({
  problem,
  configuration,
}: {
  problem: TypedRoutingProblem
  configuration: ParallelHybridEngineConfiguration
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
  const regionGraph = new DynamicRegionGraph({
    problem,
    topologyPlan,
    maximumRegionCount: configuration.maximumRegionCount,
    maximumMutationCount: configuration.maximumRegionMutationCount,
    maximumMergeRegionCount: configuration.maximumMergeRegionCount,
  }).getSnapshot()
  const boundaryContracts = negotiateBoundaryContracts({
    problem,
    topologyPlan,
    regionGraph,
  })
  copperStore.setBoundaryContractVersion(regionGraph.graphVersion)
  const schedule = createDeterministicRegionSchedule({
    regionGraph,
    maximumConcurrency: configuration.maximumConcurrency,
    maximumWaveMemoryBytes: configuration.maximumWaveMemoryBytes,
  })
  const attempts: RegionAttemptRecord[] = []
  const workerPool = new HybridRoutingWorkerPool({
    workerEntryPath: configuration.workerEntryPath,
    runtimeTarget: configuration.runtimeTarget,
    runtimeModulePath: configuration.runtimeModulePath,
    maximumWorkerCount: configuration.maximumConcurrency,
    maximumQueueLength: configuration.maximumWorkerQueueLength,
  })
  await workerPool.initialize(
    buildHybridWorkerBoardContext({
      problem,
      copperSnapshot: copperStore.getSnapshot(),
      contextId: "hybrid-board-context",
      boardContextVersion: 0,
    }),
  )
  try {
    for (const wave of schedule) {
      const copperSnapshot = copperStore.getSnapshot()
      const pendingJobs = wave.regions.flatMap((scheduledRegion) => {
        const region = regionGraph.regions.find(
          (candidate) => candidate.regionId === scheduledRegion.regionId,
        )
        if (!region) {
          throw new Error(
            `schedule references missing region ${scheduledRegion.regionId}`,
          )
        }
        return region.routeObjectIds.map((routeObjectId) => {
          const routePlan = topologyPlan.routeObjectPlans.find(
            (candidate) => candidate.routeObjectId === routeObjectId,
          )
          if (!routePlan) {
            throw new Error(`region references missing route plan ${routeObjectId}`)
          }
          const job = buildRegionJob({
            problem,
            routePlan,
            region,
            boundaryContracts,
            copperSnapshot,
            maximumExpansions: configuration.maximumSearchExpansions,
            maximumActivationRings: configuration.maximumActivationRings,
            deterministicSeed: configuration.deterministicSeed,
          })
          return workerPool.submit(job).then(
            (result): ScheduledJobResult => ({ region, routePlan, result }),
          )
        })
      })
      const completedJobs = await Promise.all(pendingJobs)
      completedJobs.sort(compareCommitOrder)
      for (const completed of completedJobs) {
        if (completed.result.status !== "completed") {
          attempts.push(createAttempt(completed))
          return createIncompleteResult({
            topologyPlan,
            demandField,
            regionGraph,
            boundaryContracts,
            copperStore,
            attempts,
            unresolvedRegionIds: getUnresolvedRegionIds({
              schedule,
              fromWaveIndex: wave.waveIndex,
            }),
            message:
              completed.result.status === "failed"
                ? completed.result.response.message
                : `job ${completed.result.jobId} was cancelled`,
          })
        }
        const delta = completed.result.response.transactionDelta
        const commit = copperStore.commit(delta)
        if (commit.status !== "committed") {
          attempts.push(
            createAttempt({
              ...completed,
              result: {
                status: "failed",
                response: {
                  type: "job_failed",
                  workerId: completed.result.response.workerId,
                  jobId: completed.result.response.jobId,
                  code: "runtime_failure",
                  message: commit.rejection.message,
                  solveTimeMs: completed.result.response.solveTimeMs,
                  cpuTimeMs: completed.result.response.cpuTimeMs,
                },
                queueWaitMs: completed.result.queueWaitMs,
              },
            }),
          )
          return createIncompleteResult({
            topologyPlan,
            demandField,
            regionGraph,
            boundaryContracts,
            copperStore,
            attempts,
            unresolvedRegionIds: getUnresolvedRegionIds({
              schedule,
              fromWaveIndex: wave.waveIndex,
            }),
            message: commit.rejection.message,
          })
        }
        demandField.applyCommittedTransaction({
          delta,
          committedSnapshot: commit.snapshot,
        })
        await workerPool.applyCopperUpdate(
          buildWorkerCopperUpdate({
            problem,
            delta,
            nextCopperVersion: commit.snapshot.version,
          }),
        )
        attempts.push(createAttempt(completed))
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
        unresolvedRegionIds: Object.freeze([]),
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
  } finally {
    await workerPool.close()
  }
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

function compareCommitOrder(
  first: ScheduledJobResult,
  second: ScheduledJobResult,
): number {
  return (
    second.region.criticality - first.region.criticality ||
    second.region.congestionPressure - first.region.congestionPressure ||
    first.region.regionId.localeCompare(second.region.regionId) ||
    first.routePlan.routeObjectId.localeCompare(second.routePlan.routeObjectId)
  )
}

function createAttempt(
  completed: ScheduledJobResult,
): RegionAttemptRecord {
  if (completed.result.status === "completed") {
    return Object.freeze({
      attemptId: `worker-attempt:${completed.result.response.jobId}`,
      regionId: completed.region.regionId,
      workerId: completed.result.response.workerId,
      strategy: "rust-multi-resolution-worker",
      queueWaitMs: completed.result.queueWaitMs,
      solveTimeMs: completed.result.response.solveTimeMs,
      workerCpuMs: completed.result.response.cpuTimeMs,
      transferredBytes: completed.result.response.receivedBytes,
      returnedBytes: completed.result.response.returnedBytes,
      outcome: "committed",
      transactionId:
        completed.result.response.transactionDelta.transactionId,
    })
  }
  if (completed.result.status === "failed") {
    return Object.freeze({
      attemptId: `worker-attempt:${completed.result.response.jobId}`,
      regionId: completed.region.regionId,
      workerId: completed.result.response.workerId,
      strategy: "rust-multi-resolution-worker",
      queueWaitMs: completed.result.queueWaitMs,
      solveTimeMs: completed.result.response.solveTimeMs,
      workerCpuMs: completed.result.response.cpuTimeMs,
      transferredBytes: 0,
      returnedBytes: 0,
      outcome: "failed",
      rejectionReason: completed.result.response.message,
    })
  }
  return Object.freeze({
    attemptId: `worker-attempt:${completed.result.jobId}`,
    regionId: completed.region.regionId,
    workerId: completed.result.workerId ?? "unassigned",
    strategy: "rust-multi-resolution-worker",
    queueWaitMs: completed.result.queueWaitMs,
    solveTimeMs: 0,
    workerCpuMs: 0,
    transferredBytes: 0,
    returnedBytes: 0,
    outcome: "cancelled",
  })
}

function getUnresolvedRegionIds({
  schedule,
  fromWaveIndex,
}: {
  schedule: readonly {
    readonly waveIndex: number
    readonly regions: readonly { readonly regionId: string }[]
  }[]
  fromWaveIndex: number
}): readonly string[] {
  return Object.freeze(
    schedule
      .filter((wave) => wave.waveIndex >= fromWaveIndex)
      .flatMap((wave) => wave.regions.map((region) => region.regionId)),
  )
}

function createIncompleteResult({
  topologyPlan,
  demandField,
  regionGraph,
  boundaryContracts,
  copperStore,
  attempts,
  unresolvedRegionIds,
  message,
}: {
  topologyPlan: SerialHybridEngineArtifacts["topologyPlan"]
  demandField: DemandCapacityField
  regionGraph: SerialHybridEngineArtifacts["regionGraph"]
  boundaryContracts: SerialHybridEngineArtifacts["boundaryContracts"]
  copperStore: TransactionalCopperStore
  attempts: readonly RegionAttemptRecord[]
  unresolvedRegionIds: readonly string[]
  message: string
}): SerialHybridEngineResult {
  const artifacts = createArtifacts({
    topologyPlan,
    demandField,
    regionGraph,
    boundaryContracts,
    copperStore,
    attempts,
  })
  return artifacts.copperSnapshot.version === 0
    ? Object.freeze({ status: "failed", artifacts, message })
    : Object.freeze({
        status: "partial",
        artifacts,
        unresolvedRegionIds,
        message,
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

function validateConfiguration(
  configuration: ParallelHybridEngineConfiguration,
): void {
  const bounds = [
    configuration.maximumConcurrency,
    configuration.maximumWorkerQueueLength,
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
    !configuration.workerEntryPath ||
    !configuration.runtimeModulePath ||
    bounds.some((value) => !Number.isSafeInteger(value) || value <= 0) ||
    !Number.isSafeInteger(configuration.deterministicSeed) ||
    configuration.deterministicSeed < 0
  ) {
    throw new Error("parallel hybrid engine configuration is invalid")
  }
}
