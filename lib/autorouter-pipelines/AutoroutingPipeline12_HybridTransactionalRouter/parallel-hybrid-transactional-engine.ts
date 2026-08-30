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
import { verifyFinalBoard } from "./final-board-verifier"
import {
  createRegionCacheKey,
  EMPTY_REGION_CACHE_SNAPSHOT,
  getRegionCacheRunSnapshot,
} from "./content-addressed-region-cache"
import type {
  ContentAddressedRegionCache,
  RegionCacheKey,
  RegionCacheSnapshot,
} from "./content-addressed-region-cache"
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
import { EMPTY_HYBRID_WORK_COUNTERS } from "./work-metrics"

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
  readonly maximumFinalViolationCount: number
  readonly regionCache?: ContentAddressedRegionCache
}

type ScheduledJobResult = {
  readonly region: DynamicRoutingRegion
  readonly routePlan: GlobalRouteObjectPlan
  readonly result: HybridWorkerPoolJobResult
  readonly source: "worker" | "cache"
  readonly cacheKey?: RegionCacheKey
}

export async function runParallelHybridTransactionalEngine({
  problem,
  configuration,
}: {
  problem: TypedRoutingProblem
  configuration: ParallelHybridEngineConfiguration
}): Promise<SerialHybridEngineResult> {
  validateConfiguration(configuration)
  const initialCacheSnapshot =
    configuration.regionCache?.getSnapshot() ?? EMPTY_REGION_CACHE_SNAPSHOT
  const getCacheMetrics = (): RegionCacheSnapshot =>
    configuration.regionCache
      ? getRegionCacheRunSnapshot({
          initial: initialCacheSnapshot,
          current: configuration.regionCache.getSnapshot(),
        })
      : EMPTY_REGION_CACHE_SNAPSHOT
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
          const cacheKey = configuration.regionCache
            ? createRegionCacheKey({
                problem,
                region,
                routePlan,
                boundaryContracts,
                job,
                runtimeTarget: configuration.runtimeTarget,
              })
            : undefined
          if (cacheKey && configuration.regionCache) {
            const cached = configuration.regionCache.get(cacheKey)
            if (cached) {
              const validationStart = performance.now()
              const validation = copperStore.validate(cached.transactionDelta)
              configuration.regionCache.recordValidationMs(
                performance.now() - validationStart,
              )
              if (validation.status === "accepted") {
                return Promise.resolve({
                  region,
                  routePlan,
                  source: "cache" as const,
                  cacheKey,
                  result: createCachedJobResult({
                    jobId: job.jobId,
                    delta: cached.transactionDelta,
                  }),
                })
              }
              configuration.regionCache.invalidate(cacheKey)
            }
          }
          return workerPool.submit(job).then(
            (result): ScheduledJobResult => ({
              region,
              routePlan,
              result,
              source: "worker",
              cacheKey,
            }),
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
            cache: getCacheMetrics(),
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
          if (completed.source === "cache" && completed.cacheKey) {
            configuration.regionCache?.invalidate(completed.cacheKey)
          }
          attempts.push(
            createAttempt(
              {
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
              },
              completed.source === "cache"
                ? EMPTY_HYBRID_WORK_COUNTERS
                : delta.work,
              false,
              "rejected",
            ),
          )
          return createIncompleteResult({
            topologyPlan,
            demandField,
            regionGraph,
            boundaryContracts,
            copperStore,
            attempts,
            cache: getCacheMetrics(),
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
        if (
          completed.source === "worker" &&
          completed.cacheKey &&
          configuration.regionCache
        ) {
          configuration.regionCache.put({
            key: completed.cacheKey,
            transactionDelta: delta,
            diagnostic: delta.diagnostic,
          })
        }
        await workerPool.applyCopperUpdate(
          buildWorkerCopperUpdate({
            problem,
            delta,
            nextCopperVersion: commit.snapshot.version,
          }),
        )
        attempts.push(
          createAttempt(
            completed,
            undefined,
            commit.transaction.wasStaleRevalidation,
          ),
        )
      }
    }
    const finalizationStartedAt = performance.now()
    const finalization = finalizeCoupledRoutes({ problem, copperStore })
    const finalizationElapsedMs = performance.now() - finalizationStartedAt
    for (const [recordIndex, record] of finalization.records.entries()) {
      demandField.applyCommittedTransaction({
        delta: record.delta,
        committedSnapshot: record.committedSnapshot,
      })
      attempts.push(
        createFinalizationAttempt(
          record.delta,
          recordIndex === 0 ? finalizationElapsedMs : 0,
        ),
      )
    }
    if (finalization.status === "failed") {
      return createIncompleteResult({
        topologyPlan,
        demandField,
        regionGraph,
        boundaryContracts,
        copperStore,
        attempts,
        cache: getCacheMetrics(),
        unresolvedRegionIds: Object.freeze([]),
        message: finalization.message,
      })
    }
    const verification = verifyFinalBoard({
      problem,
      copperSnapshot: copperStore.getSnapshot(),
      maximumViolationCount: configuration.maximumFinalViolationCount,
    })
    if (verification.status === "failed") {
      return createIncompleteResult({
        topologyPlan,
        demandField,
        regionGraph,
        boundaryContracts,
        copperStore,
        attempts,
        cache: getCacheMetrics(),
        unresolvedRegionIds: Object.freeze([]),
        message:
          verification.violations[0]?.message ??
          "independent final-board verification failed",
      })
    }
    return Object.freeze({
      status: "routed",
      verification,
      artifacts: createArtifacts({
        topologyPlan,
        demandField,
        regionGraph,
        boundaryContracts,
        copperStore,
        attempts,
        cache: getCacheMetrics(),
      }),
    })
  } finally {
    await workerPool.close()
  }
}

function createCachedJobResult({
  jobId,
  delta,
}: {
  jobId: string
  delta: HybridTransactionDelta
}): HybridWorkerPoolJobResult {
  return Object.freeze({
    status: "completed" as const,
    queueWaitMs: 0,
    response: Object.freeze({
      type: "result" as const,
      workerId: "region-cache",
      jobId,
      transactionDelta: delta,
      solveTimeMs: 0,
      cpuTimeMs: 0,
      receivedBytes: 0,
      returnedBytes: 0,
    }),
  })
}

function createFinalizationAttempt(
  delta: HybridTransactionDelta,
  solveTimeMs: number,
): RegionAttemptRecord {
  return Object.freeze({
    attemptId: `finalization-attempt:${delta.transactionId}`,
    regionId: delta.regionId,
    workerId: "control-plane",
    strategy: "transactional-coupled-finalization",
    queueWaitMs: 0,
    solveTimeMs,
    workerCpuMs: solveTimeMs,
    transferredBytes: 0,
    returnedBytes: 0,
    work: delta.work,
    wasStaleRevalidation: false,
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
  workOverride?: HybridTransactionDelta["work"],
  wasStaleRevalidation = false,
  outcomeOverride?: RegionAttemptRecord["outcome"],
): RegionAttemptRecord {
  if (completed.result.status === "completed") {
    return Object.freeze({
      attemptId: `worker-attempt:${completed.result.response.jobId}`,
      regionId: completed.region.regionId,
      workerId: completed.result.response.workerId,
      strategy:
        completed.source === "cache"
          ? "validated-content-addressed-cache"
          : "rust-multi-resolution-worker",
      queueWaitMs: completed.result.queueWaitMs,
      solveTimeMs: completed.result.response.solveTimeMs,
      workerCpuMs: completed.result.response.cpuTimeMs,
      transferredBytes: completed.result.response.receivedBytes,
      returnedBytes: completed.result.response.returnedBytes,
      work:
        workOverride ??
        (completed.source === "cache"
          ? EMPTY_HYBRID_WORK_COUNTERS
          : completed.result.response.transactionDelta.work),
      wasStaleRevalidation,
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
      work: workOverride ?? EMPTY_HYBRID_WORK_COUNTERS,
      wasStaleRevalidation,
      outcome: outcomeOverride ?? "failed",
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
    work: workOverride ?? EMPTY_HYBRID_WORK_COUNTERS,
    wasStaleRevalidation,
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
  cache,
  unresolvedRegionIds,
  message,
}: {
  topologyPlan: SerialHybridEngineArtifacts["topologyPlan"]
  demandField: DemandCapacityField
  regionGraph: SerialHybridEngineArtifacts["regionGraph"]
  boundaryContracts: SerialHybridEngineArtifacts["boundaryContracts"]
  copperStore: TransactionalCopperStore
  attempts: readonly RegionAttemptRecord[]
  cache: RegionCacheSnapshot
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
    cache,
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
  cache,
}: {
  topologyPlan: SerialHybridEngineArtifacts["topologyPlan"]
  demandField: DemandCapacityField
  regionGraph: SerialHybridEngineArtifacts["regionGraph"]
  boundaryContracts: SerialHybridEngineArtifacts["boundaryContracts"]
  copperStore: TransactionalCopperStore
  attempts: readonly RegionAttemptRecord[]
  cache: RegionCacheSnapshot
}): SerialHybridEngineArtifacts {
  return Object.freeze({
    topologyPlan,
    demandCapacityField: demandField.getSnapshot(),
    regionGraph,
    boundaryContracts,
    copperSnapshot: copperStore.getSnapshot(),
    attempts: Object.freeze([...attempts]),
    cache,
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
    configuration.maximumFinalViolationCount,
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
