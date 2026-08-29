import { HYBRID_ROUTING_CORE_PROTOCOL_VERSION } from "./rust-core-protocol"
import type {
  HybridCoreRoutePoint,
  HybridCoreSearchRequest,
} from "./rust-core-protocol"
import type {
  HybridWorkerBoardContext,
  RegionJob,
} from "./worker-protocol"

export function buildWorkerCoreSearchRequest({
  context,
  job,
  searchIdentity,
  start,
  goal,
  allowedLayers,
  traceWidthMm,
  maximumVias,
  connectedConnectionNames,
}: {
  context: HybridWorkerBoardContext
  job: RegionJob
  searchIdentity: string
  start: HybridCoreRoutePoint
  goal: HybridCoreRoutePoint
  allowedLayers: readonly string[]
  traceWidthMm: number
  maximumVias: number
  connectedConnectionNames: readonly string[]
}): HybridCoreSearchRequest {
  return Object.freeze({
    protocolVersion: HYBRID_ROUTING_CORE_PROTOCOL_VERSION,
    regionId: `${job.jobId}:${searchIdentity}`,
    bounds: job.envelope,
    activeBounds: job.bounds,
    activationBounds: Object.freeze([]),
    layerNames: allowedLayers,
    start,
    goal,
    legalViaSpans: Object.freeze(
      context.legalViaSpans.filter(
        (span) =>
          allowedLayers.includes(span.fromLayer) &&
          allowedLayers.includes(span.toLayer),
      ),
    ),
    obstacles: Object.freeze(
      context.geometry
        .filter(
          (item) =>
            !item.connectedConnectionNames.some((connectionName) =>
              connectedConnectionNames.includes(connectionName),
            ) && allowedLayers.includes(item.geometry.layer),
        )
        .map((item) => item.geometry),
    ),
    resolutionMm: job.routingResolutionMm,
    traceWidthMm,
    clearanceMm: context.clearanceMm,
    viaPadDiameterMm: context.viaPadDiameterMm,
    maximumVias,
    maximumExpansions: job.solverBudget.maximumExpansions,
    deterministicSeed:
      (job.deterministicSeed + stableStringHash(searchIdentity)) >>> 0,
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
