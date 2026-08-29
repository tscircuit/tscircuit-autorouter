import { runMultiResolutionSearch } from "./multi-resolution-router"
import { HYBRID_ROUTING_CORE_PROTOCOL_VERSION } from "./rust-core-protocol"
import type {
  HybridCoreSearchRequest,
  HybridRoutingCoreRuntime,
} from "./rust-core-protocol"
import type {
  HybridCopperOwnership,
  HybridCopperSegment,
  HybridCopperVia,
  HybridTransactionDelta,
} from "./transactional-copper-types"
import type {
  HybridWorkerBoardContext,
  HybridWorkerConnectionRule,
  RegionJob,
  RegionSearchSpec,
} from "./worker-protocol"

export type RegionJobExecutionResult =
  | {
      readonly status: "candidate"
      readonly transactionDelta: HybridTransactionDelta
    }
  | {
      readonly status: "failed"
      readonly code: "unknown_rule_reference" | "core_search_failed"
      readonly message: string
    }

export async function executeRegionJob({
  context,
  job,
  runtime,
}: {
  context: HybridWorkerBoardContext
  job: RegionJob
  runtime: HybridRoutingCoreRuntime
}): Promise<RegionJobExecutionResult> {
  const addedTraces: HybridCopperSegment[] = []
  const addedVias: HybridCopperVia[] = []
  let bendCount = 0
  let searchExpansions = 0
  let spatialIndexQueries = 0
  let drcPredicateCalls = 0
  let candidatesConstructed = 0
  let candidatesStepped = 0
  let activeRings = 0
  let solverStateRebuilds = 0
  for (const [searchIndex, search] of job.searches.entries()) {
    const rule = context.connectionRules.find(
      (candidate) =>
        candidate.connectionName === search.connectionRuleReference,
    )
    if (!rule) {
      return {
        status: "failed",
        code: "unknown_rule_reference",
        message: `job ${job.jobId} references unknown rule ${search.connectionRuleReference}`,
      }
    }
    const result = await runMultiResolutionSearch({
      runtime,
      baseRequest: createCoreRequest({
        context,
        job,
        search,
        rule,
        searchIndex,
      }),
      maximumActivationRings: job.solverBudget.maximumActivationRings,
    })
    searchExpansions += result.metrics.work.searchExpansions
    spatialIndexQueries += result.metrics.work.spatialIndexQueries
    drcPredicateCalls += result.metrics.work.geometryPredicateCalls
    candidatesConstructed += result.metrics.candidatesConstructed
    candidatesStepped += result.metrics.candidatesStepped
    activeRings += result.metrics.activeRings
    solverStateRebuilds += result.metrics.solverStateRebuilds
    if (result.status === "failed") {
      return {
        status: "failed",
        code: "core_search_failed",
        message: `${search.searchId}: ${result.response.code}: ${result.response.message}`,
      }
    }
    const ownership = createOwnership(job.ownerRouteObjectId)
    addedTraces.push(
      ...result.response.route.flatMap((point, pointIndex) => {
        const nextPoint = result.response.route[pointIndex + 1]
        if (
          !nextPoint ||
          point.layer !== nextPoint.layer ||
          (point.x === nextPoint.x && point.y === nextPoint.y)
        ) {
          return []
        }
        return [
          Object.freeze({
            kind: "segment" as const,
            copperId: `${job.transactionId}:search:${searchIndex}:segment:${pointIndex}`,
            connectionName: rule.connectionName,
            layer: point.layer,
            start: Object.freeze({ x: point.x, y: point.y }),
            end: Object.freeze({ x: nextPoint.x, y: nextPoint.y }),
            widthMm: rule.traceWidthMm,
            ownership,
          }),
        ]
      }),
    )
    addedVias.push(
      ...result.response.vias.map((via, viaIndex) =>
        Object.freeze({
          kind: "via" as const,
          copperId: `${job.transactionId}:search:${searchIndex}:via:${viaIndex}`,
          connectionName: rule.connectionName,
          x: via.x,
          y: via.y,
          fromLayer: via.fromLayer,
          toLayer: via.toLayer,
          padDiameterMm: context.viaPadDiameterMm,
          holeDiameterMm: context.viaHoleDiameterMm,
          ownership,
        }),
      ),
    )
    bendCount += result.response.cost.bendCount
  }
  const totalLengthMm = addedTraces.reduce(
    (total, segment) =>
      total +
      Math.hypot(
        segment.end.x - segment.start.x,
        segment.end.y - segment.start.y,
      ),
    0,
  )
  const softViaBudgetExceeded = context.connectionRules.some((rule) => {
    const viaCount = addedVias.filter(
      (via) => via.connectionName === rule.connectionName,
    ).length
    return viaCount > rule.viaSoftMaximum
  })
  return {
    status: "candidate",
    transactionDelta: Object.freeze({
      transactionId: job.transactionId,
      regionId: job.regionId,
      ownerRouteObjectId: job.ownerRouteObjectId,
      baseCopperVersion: job.copperVersion,
      boundaryContractVersion: job.boundaryContractVersion,
      addedTraces: Object.freeze(addedTraces),
      removedOwnedTraceIds: Object.freeze([]),
      addedVias: Object.freeze(addedVias),
      removedOwnedViaIds: Object.freeze([]),
      connectivityEffects: Object.freeze({
        connectionNames: Object.freeze([
          ...new Set(job.searches.map((search) => search.connectionRuleReference)),
        ]),
        connectedTerminalIds: Object.freeze([...job.terminalReferences]),
      }),
      affectedBounds: job.envelope,
      candidateCost: Object.freeze({
        viaCount: addedVias.length,
        totalLengthMm,
        bendCount,
        congestionCost: job.congestionCost,
        softViaBudgetExceeded,
        softViaBudgetJustification: softViaBudgetExceeded
          ? "the state-preserving regional search exhausted its same-layer strategy"
          : undefined,
      }),
      work: Object.freeze({
        searchExpansions,
        spatialIndexQueries,
        drcPredicateCalls,
        geometryAllocations: addedTraces.length + addedVias.length,
        candidatesConstructed,
        candidatesStepped,
        activeRings,
        solverStateRebuilds,
      }),
      diagnostic: job.diagnostic,
    }),
  }
}

function createCoreRequest({
  context,
  job,
  search,
  rule,
  searchIndex,
}: {
  context: HybridWorkerBoardContext
  job: RegionJob
  search: RegionSearchSpec
  rule: HybridWorkerConnectionRule
  searchIndex: number
}): HybridCoreSearchRequest {
  return Object.freeze({
    protocolVersion: HYBRID_ROUTING_CORE_PROTOCOL_VERSION,
    regionId: `${job.jobId}:search:${searchIndex}`,
    bounds: job.envelope,
    activeBounds: job.bounds,
    activationBounds: Object.freeze([]),
    layerNames: rule.allowedLayers,
    start: search.start,
    goal: search.goal,
    legalViaSpans: Object.freeze(
      context.legalViaSpans.filter(
        (span) =>
          rule.allowedLayers.includes(span.fromLayer) &&
          rule.allowedLayers.includes(span.toLayer),
      ),
    ),
    obstacles: Object.freeze(
      context.geometry
        .filter(
          (item) =>
            !item.connectedConnectionNames.includes(rule.connectionName) &&
            rule.allowedLayers.includes(item.geometry.layer),
        )
        .map((item) => item.geometry),
    ),
    resolutionMm: job.routingResolutionMm,
    traceWidthMm: rule.traceWidthMm,
    clearanceMm: context.clearanceMm,
    viaPadDiameterMm: context.viaPadDiameterMm,
    maximumVias: search.remainingViaBudget,
    maximumExpansions: job.solverBudget.maximumExpansions,
    deterministicSeed:
      (job.deterministicSeed + stableStringHash(search.searchId)) >>> 0,
  })
}

function createOwnership(ownerRouteObjectId: string): HybridCopperOwnership {
  return Object.freeze({
    mutability: "mutable",
    ownerRouteObjectIds: Object.freeze([ownerRouteObjectId]),
  })
}

function stableStringHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
