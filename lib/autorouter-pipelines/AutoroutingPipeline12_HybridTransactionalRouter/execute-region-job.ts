import {
  runMultiResolutionSearch,
  type MultiResolutionSearchResult,
} from "./multi-resolution-router"
import { buildWorkerCoreSearchRequest } from "./build-worker-core-request"
import { executeCoupledParallelJob } from "./execute-coupled-parallel-job"
import { copperPrimitivesContainGraphCycle } from "./coupled-route-constraints"
import { createPowerTreeBranchSearches } from "./power-tree-branch-portfolio"
import {
  buildSequentialSearchContext,
  candidateTouchesSequentialObstacles,
} from "./sequential-search-context"
import type {
  HybridCoreFailureCode,
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
} from "./worker-protocol"

export type RegionJobExecutionResult =
  | {
      readonly status: "candidate"
      readonly transactionDelta: HybridTransactionDelta
    }
  | {
      readonly status: "failed"
      readonly code: "unknown_rule_reference" | "core_search_failed"
      readonly coreFailureCode?: HybridCoreFailureCode
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
  if (
    job.coupling.kind === "differential_pair" ||
    job.coupling.kind === "bus"
  ) {
    return executeCoupledParallelJob({
      context,
      job: { ...job, coupling: job.coupling },
      runtime,
    })
  }
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
  const accumulateSearchMetrics = (
    searchResult: MultiResolutionSearchResult,
  ): void => {
    searchExpansions += searchResult.metrics.work.searchExpansions
    spatialIndexQueries += searchResult.metrics.work.spatialIndexQueries
    drcPredicateCalls += searchResult.metrics.work.geometryPredicateCalls
    candidatesConstructed += searchResult.metrics.candidatesConstructed
    candidatesStepped += searchResult.metrics.candidatesStepped
    activeRings += searchResult.metrics.activeRings
    solverStateRebuilds += searchResult.metrics.solverStateRebuilds
  }
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
    const ownership = createOwnership(job.ownerRouteObjectId)
    let selectedResult:
      | Extract<MultiResolutionSearchResult, { status: "solved" }>
      | undefined
    let selectedCopper: MaterializedSearchCopper | undefined
    let lastFailure:
      | Extract<MultiResolutionSearchResult, { status: "failed" }>
      | undefined
    let rejectedCyclicCandidate = false
    const branchSearches = createPowerTreeBranchSearches({
      job,
      search,
      searchIndex,
      addedTraces,
    })
    for (const [branchIndex, branchSearch] of branchSearches.entries()) {
      let result = await runMultiResolutionSearch({
        runtime,
        baseRequest: buildWorkerCoreSearchRequest({
          context,
          job,
          searchIdentity: `search:${searchIndex}:${branchSearch.searchId}:branch:${branchIndex}`,
          start: branchSearch.start,
          goal: branchSearch.goal,
          allowedLayers: rule.allowedLayers,
          traceWidthMm: rule.traceWidthMm,
          maximumVias: branchSearch.remainingViaBudget,
          connectedConnectionNames:
            rule.electricallyConnectedConnectionNames,
        }),
        maximumActivationRings: job.solverBudget.maximumActivationRings,
      })
      accumulateSearchMetrics(result)
      if (result.status === "failed") {
        lastFailure = result
        continue
      }
      let searchCopper = materializeSearchCopper({
        result,
        rule,
        job,
        searchIndex,
        ownership,
        context,
      })
      const sequentialContext = buildSequentialSearchContext({
        context,
        addedTraces,
        addedVias,
        search: branchSearch,
        traceWidthMm: rule.traceWidthMm,
        routingResolutionMm: job.routingResolutionMm,
      })
      if (
        candidateTouchesSequentialObstacles({
          baseGeometryCount: context.geometry.length,
          sequentialContext,
          candidateTraces: searchCopper.traces,
          candidateVias: searchCopper.vias,
        })
      ) {
        result = await runMultiResolutionSearch({
          runtime,
          baseRequest: buildWorkerCoreSearchRequest({
            context: sequentialContext,
            job,
            searchIdentity: `search:${searchIndex}:${branchSearch.searchId}:branch:${branchIndex}:cycle-safe`,
            start: branchSearch.start,
            goal: branchSearch.goal,
            allowedLayers: rule.allowedLayers,
            traceWidthMm: rule.traceWidthMm,
            maximumVias: branchSearch.remainingViaBudget,
            connectedConnectionNames:
              rule.electricallyConnectedConnectionNames,
          }),
          maximumActivationRings: job.solverBudget.maximumActivationRings,
        })
        accumulateSearchMetrics(result)
        if (result.status === "failed") {
          lastFailure = result
          continue
        }
        searchCopper = materializeSearchCopper({
          result,
          rule,
          job,
          searchIndex,
          ownership,
          context,
        })
      }
      if (
        job.coupling.kind === "power" &&
        job.coupling.topology === "tree" &&
        copperPrimitivesContainGraphCycle({
          segments: [...addedTraces, ...searchCopper.traces],
          vias: [...addedVias, ...searchCopper.vias],
          layerNames: context.layerNames,
        })
      ) {
        rejectedCyclicCandidate = true
        continue
      }
      selectedResult = result
      selectedCopper = searchCopper
      break
    }
    if (!selectedResult || !selectedCopper) {
      if (rejectedCyclicCandidate) {
        return {
          status: "failed",
          code: "core_search_failed",
          coreFailureCode: "no_legal_path",
          message: `${search.searchId}: no_legal_path: every bounded parent candidate created a power-tree cycle`,
        }
      }
      if (!lastFailure) {
        throw new Error(`search portfolio ${search.searchId} produced no result`)
      }
      return {
        status: "failed",
        code: "core_search_failed",
        coreFailureCode: lastFailure.response.code,
        message: `${search.searchId}: ${lastFailure.response.code}: ${lastFailure.response.message}`,
      }
    }
    addedTraces.push(...selectedCopper.traces)
    addedVias.push(...selectedCopper.vias)
    bendCount += selectedResult.response.cost.bendCount
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

function createOwnership(ownerRouteObjectId: string): HybridCopperOwnership {
  return Object.freeze({
    mutability: "mutable",
    ownerRouteObjectIds: Object.freeze([ownerRouteObjectId]),
  })
}

type MaterializedSearchCopper = {
  readonly traces: readonly HybridCopperSegment[]
  readonly vias: readonly HybridCopperVia[]
}

function materializeSearchCopper({
  result,
  rule,
  job,
  searchIndex,
  ownership,
  context,
}: {
  result: Extract<MultiResolutionSearchResult, { status: "solved" }>
  rule: HybridWorkerConnectionRule
  job: RegionJob
  searchIndex: number
  ownership: HybridCopperOwnership
  context: HybridWorkerBoardContext
}): MaterializedSearchCopper {
  return Object.freeze({
    traces: Object.freeze(
      result.response.route.flatMap((point, pointIndex) => {
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
    ),
    vias: Object.freeze(
      result.response.vias.map((via, viaIndex) =>
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
    ),
  })
}
