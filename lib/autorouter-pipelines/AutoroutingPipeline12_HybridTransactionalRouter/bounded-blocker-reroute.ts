import { buildHybridWorkerBoardContext, buildRegionJob, buildWorkerCopperUpdate } from "./build-worker-messages"
import { buildInitialCopperSnapshot, TransactionalCopperStore } from "./transactional-copper-store"
import { segmentToSegmentDistance } from "./exact-geometry"
import type {
  DynamicRegionGraphSnapshot,
  DynamicRoutingRegion,
  GlobalRouteObjectPlan,
  GlobalTopologyPlan,
  HybridBoundaryContract,
  RegionAttemptRecord,
} from "./planning-types"
import type {
  HybridCopperPrimitive,
  HybridCopperSnapshot,
  HybridTransactionDelta,
} from "./transactional-copper-types"
import type { TypedRoutingProblem } from "./types"
import type { RegionJob } from "./worker-protocol"
import {
  HybridRoutingWorkerPool,
  type HybridWorkerPoolJobResult,
} from "./worker-pool"
import { EMPTY_HYBRID_WORK_COUNTERS } from "./work-metrics"

export type BoundedBlockerRerouteConfiguration = {
  readonly workerEntryPath: string
  readonly runtimeTarget: "native" | "wasm"
  readonly runtimeModulePath: string
  readonly deterministicSeed: number
  readonly maximumSearchExpansions: number
  readonly maximumActivationRings: number
  readonly maximumBlockerCandidates: number
}

export type BoundedBlockerRerouteResult =
  | {
      readonly status: "recovered"
      readonly replacementDelta: HybridTransactionDelta
      readonly committedSnapshot: HybridCopperSnapshot
      readonly blockerRouteObjectIds: readonly string[]
      readonly attempts: readonly RegionAttemptRecord[]
    }
  | {
      readonly status: "not_recovered"
      readonly attempts: readonly RegionAttemptRecord[]
    }

export async function tryBoundedBlockerReroute({
  problem,
  topologyPlan,
  regionGraph,
  boundaryContracts,
  failedRegion,
  failedRoutePlan,
  copperStore,
  committedAttempts,
  excludedBlockerRouteObjectIds,
  configuration,
}: {
  problem: TypedRoutingProblem
  topologyPlan: GlobalTopologyPlan
  regionGraph: DynamicRegionGraphSnapshot
  boundaryContracts: readonly HybridBoundaryContract[]
  failedRegion: DynamicRoutingRegion
  failedRoutePlan: GlobalRouteObjectPlan
  copperStore: TransactionalCopperStore
  committedAttempts: readonly RegionAttemptRecord[]
  excludedBlockerRouteObjectIds: ReadonlySet<string>
  configuration: BoundedBlockerRerouteConfiguration
}): Promise<BoundedBlockerRerouteResult> {
  const attempts: RegionAttemptRecord[] = []
  const rankedCandidates = getBlockerCandidates({
    problem,
    topologyPlan,
    regionGraph,
    failedRegion,
    failedRoutePlan,
    copperSnapshot: copperStore.getSnapshot(),
    committedAttempts,
    excludedBlockerRouteObjectIds,
  })
  const singleCandidates = rankedCandidates.slice(
    0,
    configuration.maximumBlockerCandidates,
  )
  const pairCandidates = [...rankedCandidates]
    .sort(
      (first, second) =>
        second.directCorridorIntersectionCount -
          first.directCorridorIntersectionCount ||
        second.region.congestionPressure - first.region.congestionPressure ||
        second.blockingLengthMm - first.blockingLengthMm ||
        first.routePlan.routeObjectId.localeCompare(
          second.routePlan.routeObjectId,
        ),
    )
    .slice(0, configuration.maximumBlockerCandidates)
  const candidateOrders = createCandidateOrders({
    singleCandidates,
    pairCandidates,
  })
  for (const [candidateOrderIndex, candidateOrder] of candidateOrders.entries()) {
    const recoveryIndex = candidateOrderIndex + 1
    const recoveryIdentity = candidateOrder
      .map((candidate) => candidate.routePlan.routeObjectId)
      .join("+")
    const authoritativeSnapshot = copperStore.getSnapshot()
    const removedCopperIds = new Set([
      ...candidateOrder.flatMap((candidate) => candidate.removedTraceIds),
      ...candidateOrder.flatMap((candidate) => candidate.removedViaIds),
    ])
    const snapshotWithoutBlocker = Object.freeze({
      version: authoritativeSnapshot.version,
      segments: Object.freeze(
        authoritativeSnapshot.segments.filter(
          (segment) => !removedCopperIds.has(segment.copperId),
        ),
      ),
      vias: Object.freeze(
        authoritativeSnapshot.vias.filter(
          (via) => !removedCopperIds.has(via.copperId),
        ),
      ),
    })
    const recoveryPool = new HybridRoutingWorkerPool({
      workerEntryPath: configuration.workerEntryPath,
      runtimeTarget: configuration.runtimeTarget,
      runtimeModulePath: configuration.runtimeModulePath,
      maximumWorkerCount: 1,
      maximumQueueLength: 2,
    })
    try {
      await recoveryPool.initialize(
        buildHybridWorkerBoardContext({
          problem,
          copperSnapshot: snapshotWithoutBlocker,
          contextId: `blocker-recovery:${failedRegion.regionId}:${recoveryIdentity}:${recoveryIndex}`,
          boardContextVersion: 0,
        }),
      )
      const probeJob = addRecoveryJobIdentity({
        job: buildRegionJob({
          problem,
          routePlan: failedRoutePlan,
          region: expandRegionToBoard({ problem, region: failedRegion }),
          boundaryContracts,
          copperSnapshot: snapshotWithoutBlocker,
          maximumExpansions: configuration.maximumSearchExpansions,
          maximumActivationRings: configuration.maximumActivationRings,
          deterministicSeed: configuration.deterministicSeed,
        }),
        recoveryIdentity: `probe:${recoveryIdentity}:${recoveryIndex}`,
      })
      const probeResult = await recoveryPool.submit(probeJob)
      if (probeResult.status !== "completed") {
        attempts.push(
          createRecoveryAttempt({
            region: failedRegion,
            routePlan: failedRoutePlan,
            result: probeResult,
            recoveryIndex,
            recoveryIdentity,
            phase: "probe",
            outcome: "failed",
          }),
        )
        continue
      }
      const probeDelta = probeResult.response.transactionDelta
      attempts.push(
        createRecoveryAttempt({
          region: failedRegion,
          routePlan: failedRoutePlan,
          result: probeResult,
          recoveryIndex,
          recoveryIdentity,
          phase: "probe",
          outcome: "candidate",
        }),
      )
      let provisionalSnapshot = Object.freeze({
        version: snapshotWithoutBlocker.version + 1,
        segments: Object.freeze([
          ...snapshotWithoutBlocker.segments,
          ...probeDelta.addedTraces,
        ]),
        vias: Object.freeze([
          ...snapshotWithoutBlocker.vias,
          ...probeDelta.addedVias,
        ]),
      })
      await recoveryPool.applyCopperUpdate(
        buildWorkerCopperUpdate({
          problem,
          delta: probeDelta,
          nextCopperVersion: provisionalSnapshot.version,
        }),
      )
      const routedBlockers: {
        readonly candidate: BlockerCandidate
        readonly result: Extract<HybridWorkerPoolJobResult, { status: "completed" }>
      }[] = []
      let blockerRerouteFailed = false
      for (const [blockerIndex, candidate] of candidateOrder.entries()) {
        const blockerJob = addRecoveryJobIdentity({
          job: buildRegionJob({
            problem,
            routePlan: candidate.routePlan,
            region: expandRegionToBoard({ problem, region: candidate.region }),
            boundaryContracts,
            copperSnapshot: provisionalSnapshot,
            maximumExpansions: configuration.maximumSearchExpansions,
            maximumActivationRings: configuration.maximumActivationRings,
            deterministicSeed: configuration.deterministicSeed,
          }),
          recoveryIdentity: `blocker:${failedRoutePlan.routeObjectId}:${recoveryIdentity}:${blockerIndex + 1}`,
        })
        const blockerResult = await recoveryPool.submit(blockerJob)
        if (blockerResult.status !== "completed") {
          attempts.push(
            createRecoveryAttempt({
              region: candidate.region,
              routePlan: candidate.routePlan,
              result: blockerResult,
              recoveryIndex,
              recoveryIdentity,
              phase: "blocker",
              outcome: "failed",
            }),
          )
          blockerRerouteFailed = true
          break
        }
        routedBlockers.push({ candidate, result: blockerResult })
        const blockerDelta = blockerResult.response.transactionDelta
        provisionalSnapshot = appendProvisionalDelta({
          snapshot: provisionalSnapshot,
          delta: blockerDelta,
        })
        await recoveryPool.applyCopperUpdate(
          buildWorkerCopperUpdate({
            problem,
            delta: blockerDelta,
            nextCopperVersion: provisionalSnapshot.version,
          }),
        )
      }
      if (blockerRerouteFailed) continue
      const replacementDelta = createMultiBlockerReplacementDelta({
        candidateDeltas: routedBlockers.map(
          ({ result }) => result.response.transactionDelta,
        ),
        authoritativeCopperVersion: authoritativeSnapshot.version,
        removedTraceIds: candidateOrder.flatMap(
          (candidate) => candidate.removedTraceIds,
        ),
        removedViaIds: candidateOrder.flatMap(
          (candidate) => candidate.removedViaIds,
        ),
        recoveryIndex,
        failedRouteObjectId: failedRoutePlan.routeObjectId,
      })
      const commit = copperStore.commit(replacementDelta)
      if (commit.status !== "committed") {
        for (const [blockerIndex, routedBlocker] of routedBlockers.entries()) {
          attempts.push(
            createRecoveryAttempt({
              region: routedBlocker.candidate.region,
              routePlan: routedBlocker.candidate.routePlan,
              result: routedBlocker.result,
              recoveryIndex,
              recoveryIdentity,
              phase: "blocker",
              outcome:
                blockerIndex === routedBlockers.length - 1
                  ? "rejected"
                  : "candidate",
              rejectionReason:
                blockerIndex === routedBlockers.length - 1
                  ? commit.rejection.message
                  : undefined,
            }),
          )
        }
        continue
      }
      for (const [blockerIndex, routedBlocker] of routedBlockers.entries()) {
        attempts.push(
          createRecoveryAttempt({
            region: routedBlocker.candidate.region,
            routePlan: routedBlocker.candidate.routePlan,
            result: routedBlocker.result,
            recoveryIndex,
            recoveryIdentity,
            phase: "blocker",
            outcome:
              blockerIndex === routedBlockers.length - 1
                ? "committed"
                : "candidate",
            transactionId:
              blockerIndex === routedBlockers.length - 1
                ? replacementDelta.transactionId
                : undefined,
            wasStaleRevalidation:
              blockerIndex === routedBlockers.length - 1 &&
              commit.transaction.wasStaleRevalidation,
          }),
        )
      }
      return Object.freeze({
        status: "recovered" as const,
        replacementDelta,
        committedSnapshot: commit.snapshot,
        blockerRouteObjectIds: Object.freeze(
          candidateOrder.map((candidate) => candidate.routePlan.routeObjectId),
        ),
        attempts: Object.freeze(attempts),
      })
    } finally {
      await recoveryPool.close()
    }
  }
  return Object.freeze({
    status: "not_recovered" as const,
    attempts: Object.freeze(attempts),
  })
}

type BlockerCandidate = {
  readonly region: DynamicRoutingRegion
  readonly routePlan: GlobalRouteObjectPlan
  readonly removedTraceIds: readonly string[]
  readonly removedViaIds: readonly string[]
  readonly directCorridorIntersectionCount: number
  readonly blockingLengthMm: number
}

function createCandidateOrders({
  singleCandidates,
  pairCandidates,
}: {
  singleCandidates: readonly BlockerCandidate[]
  pairCandidates: readonly BlockerCandidate[]
}): readonly (readonly BlockerCandidate[])[] {
  const singles = singleCandidates.map((candidate) =>
    Object.freeze([candidate]),
  )
  if (pairCandidates.length < 2) return Object.freeze(singles)
  return Object.freeze([
    ...singles,
    Object.freeze([pairCandidates[0]!, pairCandidates[1]!]),
    Object.freeze([pairCandidates[1]!, pairCandidates[0]!]),
  ])
}

function getBlockerCandidates({
  problem,
  topologyPlan,
  regionGraph,
  failedRegion,
  failedRoutePlan,
  copperSnapshot,
  committedAttempts,
  excludedBlockerRouteObjectIds,
}: {
  problem: TypedRoutingProblem
  topologyPlan: GlobalTopologyPlan
  regionGraph: DynamicRegionGraphSnapshot
  failedRegion: DynamicRoutingRegion
  failedRoutePlan: GlobalRouteObjectPlan
  copperSnapshot: HybridCopperSnapshot
  committedAttempts: readonly RegionAttemptRecord[]
  excludedBlockerRouteObjectIds: ReadonlySet<string>
}): readonly BlockerCandidate[] {
  const initialSnapshot = buildInitialCopperSnapshot({ problem })
  const initialCopperIds = new Set([
    ...initialSnapshot.segments.map((segment) => segment.copperId),
    ...initialSnapshot.vias.map((via) => via.copperId),
  ])
  const conflictingRegionIds = new Set(failedRegion.conflictRegionIds)
  const candidates: BlockerCandidate[] = []
  const seenRouteObjectIds = new Set<string>()
  for (const attempt of [...committedAttempts].reverse()) {
    if (attempt.outcome !== "committed") continue
    const region = regionGraph.regions.find(
      (candidate) => candidate.regionId === attempt.regionId,
    )
    if (!region || !conflictingRegionIds.has(region.regionId)) continue
    for (const routeObjectId of region.routeObjectIds) {
      if (
        seenRouteObjectIds.has(routeObjectId) ||
        excludedBlockerRouteObjectIds.has(routeObjectId)
      ) {
        continue
      }
      seenRouteObjectIds.add(routeObjectId)
      const routePlan = topologyPlan.routeObjectPlans.find(
        (candidate) => candidate.routeObjectId === routeObjectId,
      )
      if (!routePlan) continue
      const ownedGeneratedPrimitives = [
        ...copperSnapshot.segments,
        ...copperSnapshot.vias,
      ].filter(
        (primitive) =>
          !initialCopperIds.has(primitive.copperId) &&
          isExclusivelyOwnedBy(primitive, routeObjectId),
      )
      const removedTraceIds = ownedGeneratedPrimitives.flatMap((primitive) =>
        primitive.kind === "segment" ? [primitive.copperId] : [],
      )
      const removedViaIds = ownedGeneratedPrimitives.flatMap((primitive) =>
        primitive.kind === "via" ? [primitive.copperId] : [],
      )
      if (removedTraceIds.length + removedViaIds.length === 0) continue
      candidates.push(
        Object.freeze({
          region,
          routePlan,
          removedTraceIds: Object.freeze(removedTraceIds),
          removedViaIds: Object.freeze(removedViaIds),
          directCorridorIntersectionCount:
            countDirectCorridorIntersections({
              primitives: ownedGeneratedPrimitives,
              failedRoutePlan,
            }),
          blockingLengthMm: ownedGeneratedPrimitives.reduce(
            (total, primitive) =>
              primitive.kind === "segment"
                ? total +
                  Math.hypot(
                    primitive.end.x - primitive.start.x,
                    primitive.end.y - primitive.start.y,
                  )
                : total,
            0,
          ),
        }),
      )
    }
  }
  return Object.freeze(
    candidates.sort(
      (first, second) =>
        second.region.congestionPressure - first.region.congestionPressure ||
        second.blockingLengthMm - first.blockingLengthMm ||
        first.routePlan.routeObjectId.localeCompare(
          second.routePlan.routeObjectId,
        ),
    ),
  )
}

export function countDirectCorridorIntersections({
  primitives,
  failedRoutePlan,
}: {
  primitives: readonly HybridCopperPrimitive[]
  failedRoutePlan: GlobalRouteObjectPlan
}): number {
  return primitives.reduce((intersectionCount, primitive) => {
    if (primitive.kind !== "segment") return intersectionCount
    const intersects = failedRoutePlan.corridors.some(
      (corridor) =>
        segmentToSegmentDistance({
          firstStart: primitive.start,
          firstEnd: primitive.end,
          secondStart: corridor.start,
          secondEnd: corridor.end,
        }) <= 1e-9,
    )
    return intersectionCount + (intersects ? 1 : 0)
  }, 0)
}

function isExclusivelyOwnedBy(
  primitive: HybridCopperPrimitive,
  routeObjectId: string,
): boolean {
  return (
    primitive.ownership.mutability === "mutable" &&
    primitive.ownership.ownerRouteObjectIds.length === 1 &&
    primitive.ownership.ownerRouteObjectIds[0] === routeObjectId
  )
}

function expandRegionToBoard({
  problem,
  region,
}: {
  problem: TypedRoutingProblem
  region: DynamicRoutingRegion
}): DynamicRoutingRegion {
  return Object.freeze({
    ...region,
    maximumEnvelope: problem.compiledRules.boardBounds,
    mutationGeneration: region.mutationGeneration + 1,
  })
}

function addRecoveryJobIdentity({
  job,
  recoveryIdentity,
}: {
  job: RegionJob
  recoveryIdentity: string
}): RegionJob {
  return Object.freeze({
    ...job,
    jobId: `${job.jobId}:recovery:${recoveryIdentity}`,
    transactionId: `${job.transactionId}:recovery:${recoveryIdentity}`,
  })
}

function appendProvisionalDelta({
  snapshot,
  delta,
}: {
  snapshot: HybridCopperSnapshot
  delta: HybridTransactionDelta
}): HybridCopperSnapshot {
  return Object.freeze({
    version: snapshot.version + 1,
    segments: Object.freeze([...snapshot.segments, ...delta.addedTraces]),
    vias: Object.freeze([...snapshot.vias, ...delta.addedVias]),
  })
}

export function createBlockerReplacementDelta({
  candidateDelta,
  authoritativeCopperVersion,
  removedTraceIds,
  removedViaIds,
  recoveryIndex,
  failedRouteObjectId,
}: {
  candidateDelta: HybridTransactionDelta
  authoritativeCopperVersion: number
  removedTraceIds: readonly string[]
  removedViaIds: readonly string[]
  recoveryIndex: number
  failedRouteObjectId: string
}): HybridTransactionDelta {
  return createMultiBlockerReplacementDelta({
    candidateDeltas: [candidateDelta],
    authoritativeCopperVersion,
    removedTraceIds,
    removedViaIds,
    recoveryIndex,
    failedRouteObjectId,
  })
}

export function createMultiBlockerReplacementDelta({
  candidateDeltas,
  authoritativeCopperVersion,
  removedTraceIds,
  removedViaIds,
  recoveryIndex,
  failedRouteObjectId,
}: {
  candidateDeltas: readonly HybridTransactionDelta[]
  authoritativeCopperVersion: number
  removedTraceIds: readonly string[]
  removedViaIds: readonly string[]
  recoveryIndex: number
  failedRouteObjectId: string
}): HybridTransactionDelta {
  const primaryDelta = candidateDeltas[0]
  if (!primaryDelta) {
    throw new Error("blocker replacement requires at least one candidate delta")
  }
  if (
    candidateDeltas.some(
      (delta) =>
        delta.boundaryContractVersion !==
        primaryDelta.boundaryContractVersion,
    )
  ) {
    throw new Error("blocker replacement candidates must share one boundary contract version")
  }
  const additionalOwnerRouteObjectIds = [
    ...new Set(
      candidateDeltas
        .slice(1)
        .map((delta) => delta.ownerRouteObjectId)
        .filter(
          (ownerRouteObjectId) =>
            ownerRouteObjectId !== primaryDelta.ownerRouteObjectId,
        ),
    ),
  ]
  const softViaBudgetJustifications = candidateDeltas.flatMap((delta) =>
    delta.candidateCost.softViaBudgetJustification
      ? [delta.candidateCost.softViaBudgetJustification]
      : [],
  )
  return Object.freeze({
    transactionId: `${primaryDelta.transactionId}:replacement:${recoveryIndex}`,
    regionId: primaryDelta.regionId,
    ownerRouteObjectId: primaryDelta.ownerRouteObjectId,
    additionalOwnerRouteObjectIds: Object.freeze(
      additionalOwnerRouteObjectIds,
    ),
    baseCopperVersion: authoritativeCopperVersion,
    boundaryContractVersion: primaryDelta.boundaryContractVersion,
    addedTraces: Object.freeze(
      candidateDeltas.flatMap((delta) => delta.addedTraces),
    ),
    removedOwnedTraceIds: Object.freeze([...removedTraceIds]),
    addedVias: Object.freeze(
      candidateDeltas.flatMap((delta) => delta.addedVias),
    ),
    removedOwnedViaIds: Object.freeze([...removedViaIds]),
    connectivityEffects: Object.freeze({
      connectionNames: Object.freeze([
        ...new Set(
          candidateDeltas.flatMap(
            (delta) => delta.connectivityEffects.connectionNames,
          ),
        ),
      ]),
      connectedTerminalIds: Object.freeze([
        ...new Set(
          candidateDeltas.flatMap(
            (delta) => delta.connectivityEffects.connectedTerminalIds,
          ),
        ),
      ]),
    }),
    affectedBounds: Object.freeze(
      candidateDeltas.slice(1).reduce(
        (bounds, delta) => ({
          minX: Math.min(bounds.minX, delta.affectedBounds.minX),
          maxX: Math.max(bounds.maxX, delta.affectedBounds.maxX),
          minY: Math.min(bounds.minY, delta.affectedBounds.minY),
          maxY: Math.max(bounds.maxY, delta.affectedBounds.maxY),
        }),
        primaryDelta.affectedBounds,
      ),
    ),
    candidateCost: Object.freeze({
      viaCount: candidateDeltas.reduce(
        (total, delta) => total + delta.candidateCost.viaCount,
        0,
      ),
      totalLengthMm: candidateDeltas.reduce(
        (total, delta) => total + delta.candidateCost.totalLengthMm,
        0,
      ),
      bendCount: candidateDeltas.reduce(
        (total, delta) => total + delta.candidateCost.bendCount,
        0,
      ),
      congestionCost: candidateDeltas.reduce(
        (total, delta) => total + delta.candidateCost.congestionCost,
        0,
      ),
      softViaBudgetExceeded: candidateDeltas.some(
        (delta) => delta.candidateCost.softViaBudgetExceeded,
      ),
      ...(softViaBudgetJustifications.length > 0
        ? {
            softViaBudgetJustification:
              softViaBudgetJustifications.join("; "),
          }
        : {}),
    }),
    work: Object.freeze({
      searchExpansions: sumWorkCounter(candidateDeltas, "searchExpansions"),
      spatialIndexQueries: sumWorkCounter(candidateDeltas, "spatialIndexQueries"),
      drcPredicateCalls: sumWorkCounter(candidateDeltas, "drcPredicateCalls"),
      geometryAllocations: sumWorkCounter(candidateDeltas, "geometryAllocations"),
      candidatesConstructed: sumWorkCounter(candidateDeltas, "candidatesConstructed"),
      candidatesStepped: sumWorkCounter(candidateDeltas, "candidatesStepped"),
      activeRings: sumWorkCounter(candidateDeltas, "activeRings"),
      solverStateRebuilds: sumWorkCounter(candidateDeltas, "solverStateRebuilds"),
    }),
    diagnostic: Object.freeze({
      code: "bounded_blocker_reroute",
      message: `atomically rerouted ${candidateDeltas.length} blocker route objects around reserved path for ${failedRouteObjectId}`,
      regionIds: Object.freeze(
        candidateDeltas.map((delta) => delta.regionId),
      ),
      connectionNames: Object.freeze([
        ...new Set(
          candidateDeltas.flatMap(
            (delta) => delta.connectivityEffects.connectionNames,
          ),
        ),
      ]),
    }),
  })
}

function sumWorkCounter(
  deltas: readonly HybridTransactionDelta[],
  counter: keyof HybridTransactionDelta["work"],
): number {
  return deltas.reduce((total, delta) => total + delta.work[counter], 0)
}

function createRecoveryAttempt({
  region,
  routePlan,
  result,
  recoveryIndex,
  recoveryIdentity,
  phase,
  outcome,
  rejectionReason,
  transactionId,
  wasStaleRevalidation = false,
}: {
  region: DynamicRoutingRegion
  routePlan: GlobalRouteObjectPlan
  result: HybridWorkerPoolJobResult
  recoveryIndex: number
  recoveryIdentity: string
  phase: "probe" | "blocker"
  outcome: RegionAttemptRecord["outcome"]
  rejectionReason?: string
  transactionId?: string
  wasStaleRevalidation?: boolean
}): RegionAttemptRecord {
  const response = result.status === "cancelled" ? undefined : result.response
  const delta = response?.type === "result" ? response.transactionDelta : undefined
  return Object.freeze({
    attemptId: `blocker-recovery:${recoveryIndex}:${phase}:${recoveryIdentity}:${region.regionId}:${routePlan.routeObjectId}`,
    regionId: region.regionId,
    workerId: response?.workerId ?? "blocker-recovery-unassigned",
    strategy:
      phase === "probe"
        ? "bounded-blocker-recovery-probe"
        : "bounded-blocker-transactional-reroute",
    queueWaitMs: result.queueWaitMs,
    solveTimeMs: response?.solveTimeMs ?? 0,
    workerCpuMs: response?.cpuTimeMs ?? 0,
    transferredBytes: response?.type === "result" ? response.receivedBytes : 0,
    returnedBytes: response?.type === "result" ? response.returnedBytes : 0,
    work: delta?.work ?? EMPTY_HYBRID_WORK_COUNTERS,
    requeueIndex: recoveryIndex,
    wasStaleRevalidation,
    outcome,
    rejectionReason:
      rejectionReason ??
      (response?.type === "job_failed" ? response.message : undefined),
    transactionId: transactionId ?? delta?.transactionId,
  })
}
