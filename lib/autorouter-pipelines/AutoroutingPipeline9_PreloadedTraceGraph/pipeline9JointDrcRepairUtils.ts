import { getDrcErrorParticipantTraceIds as getPipeline9DrcErrorParticipantTraceIds } from "lib/utils/getDrcErrorTraceIds"
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

export { getDrcErrorTraceIds as getPipeline9DrcErrorTraceIds } from "lib/utils/getDrcErrorTraceIds"

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

export const isPipeline9DrcCandidateBetter = (
  candidateErrors: Pipeline9DrcError[],
  currentErrors: Pipeline9DrcError[],
) =>
  candidateErrors.length < currentErrors.length ||
  (candidateErrors.length === currentErrors.length &&
    getDrcIssueScore(candidateErrors) <
      getDrcIssueScore(currentErrors) - SCORE_EPSILON)

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
