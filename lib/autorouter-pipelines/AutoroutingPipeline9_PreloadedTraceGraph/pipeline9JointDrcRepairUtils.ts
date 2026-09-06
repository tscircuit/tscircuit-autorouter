import type { DrcEvaluator } from "high-density-repair03/lib"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

export type Pipeline9CollapsedTraceParticipant = {
  solverTraceId: string
  evaluationTraceIds: string[]
}

export type Pipeline9DrcError = Record<string, unknown> & {
  __collapsed_trace_participants?: Pipeline9CollapsedTraceParticipant[]
}

export type Pipeline9PreloadRepairTraceIds = ReadonlySet<string> & {
  readonly collidingFixedTraceIds?: ReadonlySet<string>
}

const SCORE_EPSILON = 1e-9

export const clonePipeline9HdRoutes = (
  routes: HighDensityRoute[],
): HighDensityRoute[] =>
  routes.map((route) => ({
    ...route,
    route: route.route.map((point) => ({ ...point })),
    vias: route.vias.map((via) => ({ ...via })),
  }))

export const getPipeline9DrcErrors = (
  drcEvaluator: DrcEvaluator,
  routes: HighDensityRoute[],
): Pipeline9DrcError[] => {
  const result = drcEvaluator({ hdRoutes: routes, traces: [] })
  return (
    Array.isArray(result) ? result : (result.errorsWithCenters ?? result.errors)
  ) as Pipeline9DrcError[]
}

const getPipeline9DrcErrorParticipantTraceIds = (
  error: Pipeline9DrcError,
): string[] => {
  const primaryTraceId =
    typeof error.pcb_trace_id === "string" ? error.pcb_trace_id : undefined
  const explicitTraceIds = Array.isArray(error.pcb_trace_ids)
    ? error.pcb_trace_ids.filter(
        (traceId): traceId is string => typeof traceId === "string",
      )
    : []
  const viaIds = [
    ...(typeof error.pcb_via_id === "string" ? [error.pcb_via_id] : []),
    ...(Array.isArray(error.pcb_via_ids) ? error.pcb_via_ids : []),
  ].filter((viaId): viaId is string => typeof viaId === "string")
  const pairPrefix = primaryTraceId ? `overlap_${primaryTraceId}_` : undefined
  const encodedOtherTraceId =
    pairPrefix &&
    typeof error.pcb_trace_error_id === "string" &&
    error.pcb_trace_error_id.startsWith(pairPrefix)
      ? error.pcb_trace_error_id.slice(pairPrefix.length)
      : undefined
  if (explicitTraceIds.length > 0) {
    const participantTraceIds =
      primaryTraceId && !explicitTraceIds.includes(primaryTraceId)
        ? [primaryTraceId, ...explicitTraceIds]
        : [...explicitTraceIds]
    if (
      participantTraceIds.length < 2 &&
      encodedOtherTraceId &&
      !viaIds.includes(encodedOtherTraceId)
    ) {
      participantTraceIds.push(encodedOtherTraceId)
    }
    return participantTraceIds
  }
  return [primaryTraceId, encodedOtherTraceId].filter(
    (traceId): traceId is string =>
      typeof traceId === "string" && !viaIds.includes(traceId),
  )
}

export const getPipeline9DrcErrorTraceIds = (
  error: Pipeline9DrcError,
): string[] => {
  return getPipeline9DrcErrorParticipantTraceIds(error).filter(
    (traceId, traceIndex, allTraceIds) =>
      allTraceIds.indexOf(traceId) === traceIndex,
  )
}

export const isPipeline9DrcErrorOwnedByPreloadRepair = ({
  error,
  preloadRepairTraceIds,
}: {
  error: Pipeline9DrcError
  preloadRepairTraceIds: Pipeline9PreloadRepairTraceIds
}): boolean => {
  const participantTraceIds = getPipeline9DrcErrorParticipantTraceIds(error)
  if (
    participantTraceIds.some((traceId) => preloadRepairTraceIds.has(traceId))
  ) {
    return true
  }
  const collapsedTraceIds = (
    error.__collapsed_trace_participants ?? []
  ).flatMap((participant) =>
    new Set(participant.evaluationTraceIds).size > 1
      ? [participant.solverTraceId]
      : [],
  )
  return collapsedTraceIds.some((traceId) =>
    preloadRepairTraceIds.collidingFixedTraceIds?.has(traceId),
  )
}

const getDrcIssueScore = (errors: Pipeline9DrcError[]): number =>
  errors.reduce((score, error) => {
    if (
      typeof error.actual_clearance === "number" &&
      typeof error.minimum_clearance === "number"
    ) {
      return (
        score + Math.max(0, error.minimum_clearance - error.actual_clearance)
      )
    }
    const message = typeof error.message === "string" ? error.message : ""
    const gap = message.match(/gap: (-?\d+(?:\.\d+)?)mm/)
    if (gap) {
      return score + Math.max(0, 0.1 - Number.parseFloat(gap[1]!))
    }
    return score + 1
  }, 0)

export const isPipeline9IllegalCopperContactDrcError = (
  error: Pipeline9DrcError,
): boolean => {
  const message =
    typeof error.message === "string" ? error.message.toLowerCase() : ""
  if (message.includes("accidental contact")) return true
  if (message.includes("overlaps with pcb_trace")) return true
  if (message.includes("overlaps with pcb_via")) return true

  if (
    typeof error.actual_clearance === "number" &&
    error.actual_clearance < 0
  ) {
    return true
  }

  const gapMatch = message.match(/gap: (-?\d+(?:\.\d+)?)mm/)
  return gapMatch !== null && Number.parseFloat(gapMatch[1]!) < 0
}

const getPipeline9DrcErrorIdentity = (error: Pipeline9DrcError): string => {
  const identifiers = Object.entries(error)
    .filter(
      ([key, value]) =>
        key !== "source_trace_id" &&
        (key.endsWith("_id") || key.endsWith("_ids")) &&
        value !== undefined &&
        value !== "",
    )
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
  const normalizedMessage =
    typeof error.message === "string"
      ? error.message.replace(/-?\d+\.\d+/g, "#")
      : ""
  return JSON.stringify([
    error.type ?? error.error_type,
    identifiers,
    normalizedMessage,
  ])
}

const hasNewIllegalCopperContact = (
  candidateErrors: Pipeline9DrcError[],
  currentErrors: Pipeline9DrcError[],
): boolean => {
  const currentContactIdentities = new Set(
    currentErrors
      .filter(isPipeline9IllegalCopperContactDrcError)
      .map(getPipeline9DrcErrorIdentity),
  )
  return candidateErrors
    .filter(isPipeline9IllegalCopperContactDrcError)
    .some(
      (error) =>
        !currentContactIdentities.has(getPipeline9DrcErrorIdentity(error)),
    )
}

const hasNewDrcError = (
  candidateErrors: Pipeline9DrcError[],
  currentErrors: Pipeline9DrcError[],
): boolean => {
  const currentErrorIdentities = new Set(
    currentErrors.map(getPipeline9DrcErrorIdentity),
  )
  return candidateErrors.some(
    (error) => !currentErrorIdentities.has(getPipeline9DrcErrorIdentity(error)),
  )
}

export const isPipeline9DrcCandidateNoWorse = (
  candidateErrors: Pipeline9DrcError[],
  currentErrors: Pipeline9DrcError[],
): boolean => {
  const candidateIllegalContactCount = candidateErrors.filter(
    isPipeline9IllegalCopperContactDrcError,
  ).length
  const currentIllegalContactCount = currentErrors.filter(
    isPipeline9IllegalCopperContactDrcError,
  ).length
  if (candidateIllegalContactCount > currentIllegalContactCount) return false
  if (hasNewIllegalCopperContact(candidateErrors, currentErrors)) return false
  if (candidateErrors.length < currentErrors.length) return true
  if (candidateErrors.length > currentErrors.length) return false
  if (hasNewDrcError(candidateErrors, currentErrors)) return false
  return (
    getDrcIssueScore(candidateErrors) <=
    getDrcIssueScore(currentErrors) + SCORE_EPSILON
  )
}

export const isPipeline9DrcCandidateBetter = (
  candidateErrors: Pipeline9DrcError[],
  currentErrors: Pipeline9DrcError[],
): boolean => {
  const candidateIllegalContactCount = candidateErrors.filter(
    isPipeline9IllegalCopperContactDrcError,
  ).length
  const currentIllegalContactCount = currentErrors.filter(
    isPipeline9IllegalCopperContactDrcError,
  ).length
  if (candidateIllegalContactCount > currentIllegalContactCount) return false
  if (hasNewIllegalCopperContact(candidateErrors, currentErrors)) return false

  return (
    candidateErrors.length < currentErrors.length ||
    (candidateErrors.length === currentErrors.length &&
      getDrcIssueScore(candidateErrors) <
        getDrcIssueScore(currentErrors) - SCORE_EPSILON)
  )
}

export const getPipeline9RouteIndexByTraceId = ({
  routes,
  newConnections,
  syntheticConnectionNames,
}: {
  routes: HighDensityRoute[]
  newConnections: SimpleRouteConnection[]
  syntheticConnectionNames: ReadonlySet<string>
}) => {
  const routableConnectionNames = new Set([
    ...newConnections.map((connection) => connection.name),
    ...syntheticConnectionNames,
  ])
  const routeCountByConnectionName = new Map<string, number>()
  const routeIndexByTraceId = new Map<string, number>()
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
    const route = routes[routeIndex]!
    if (!routableConnectionNames.has(route.connectionName)) continue
    const connectionRouteIndex =
      routeCountByConnectionName.get(route.connectionName) ?? 0
    routeCountByConnectionName.set(
      route.connectionName,
      connectionRouteIndex + 1,
    )
    routeIndexByTraceId.set(
      `${route.connectionName}_${connectionRouteIndex}`,
      routeIndex,
    )
  }
  return routeIndexByTraceId
}
