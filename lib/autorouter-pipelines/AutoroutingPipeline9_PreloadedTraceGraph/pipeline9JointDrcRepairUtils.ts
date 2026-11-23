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

const getDrcIssueScore = (errors: Pipeline9DrcError[]) =>
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

/** A short, keyed by what touches; unidentified when its ids are missing. */
export type Pipeline9DrcContact =
  | { kind: "identified"; key: string }
  | { kind: "unidentified" }

/**
 * The short a trace error reports, keyed by the objects touching whichever
 * side reported it. Undefined when the error is not copper in contact.
 * The DRC engine reports one error per pair of objects however many points
 * they touch at, so a second contact point between them is the same short.
 */
export const getPipeline9DrcContact = (
  error: Pipeline9DrcError,
): Pipeline9DrcContact | undefined => {
  if (error.type !== "pcb_trace_error") return undefined
  if (typeof error.actual_clearance !== "number") return undefined
  if (error.actual_clearance >= 0) return undefined

  const unidentified: Pipeline9DrcContact = { kind: "unidentified" }
  const traceId = error.pcb_trace_id
  const obstacleIds = [error.pcb_smtpad_id, error.pcb_plated_hole_id].filter(
    (id) => id !== undefined,
  )

  // A trace on a pad or plated hole names one trace and one obstacle.
  if (obstacleIds.length > 1) return unidentified
  if (obstacleIds.length === 1) {
    const obstacleId = obstacleIds[0]
    if (typeof traceId !== "string") return unidentified
    if (traceId === "") return unidentified
    if (typeof obstacleId !== "string") return unidentified
    if (obstacleId === "") return unidentified
    return { kind: "identified", key: `${traceId} touches ${obstacleId}` }
  }

  // A trace touching another trace or its via names two different traces.
  if (!Array.isArray(error.pcb_trace_ids)) return unidentified
  if (error.pcb_trace_ids.length !== 2) return unidentified
  const [firstTraceId, secondTraceId]: unknown[] = error.pcb_trace_ids
  if (typeof firstTraceId !== "string") return unidentified
  if (typeof secondTraceId !== "string") return unidentified
  if (firstTraceId === "") return unidentified
  if (secondTraceId === "") return unidentified
  if (firstTraceId === secondTraceId) return unidentified
  const key = [firstTraceId, secondTraceId].sort().join(" touches ")
  return { kind: "identified", key }
}

/**
 * True when the candidate has a short the current routes do not. A short
 * without the ids that name it counts as new: it cannot be matched.
 */
export const introducesPipeline9DrcContact = (
  candidateErrors: Pipeline9DrcError[],
  currentErrors: Pipeline9DrcError[],
): boolean => {
  const currentContactKeys = new Set<string>()
  for (const error of currentErrors) {
    const contact = getPipeline9DrcContact(error)
    if (contact?.kind === "identified") currentContactKeys.add(contact.key)
  }
  for (const error of candidateErrors) {
    const contact = getPipeline9DrcContact(error)
    if (!contact) continue
    if (contact.kind === "unidentified") return true
    if (!currentContactKeys.has(contact.key)) return true
  }
  return false
}

/**
 * A candidate is better when it has fewer DRC errors, or as many with a lower
 * score. With rejectNewContacts, a candidate that puts two objects in contact
 * that were not already touching is never better: use it where no later step
 * can remove the short.
 */
export const isPipeline9DrcCandidateBetter = ({
  candidateErrors,
  currentErrors,
  rejectNewContacts = false,
}: {
  candidateErrors: Pipeline9DrcError[]
  currentErrors: Pipeline9DrcError[]
  rejectNewContacts?: boolean
}): boolean => {
  if (rejectNewContacts) {
    if (introducesPipeline9DrcContact(candidateErrors, currentErrors)) {
      return false
    }
  }
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
