import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  DrcEvaluator,
  SimpleRouteJson as RepairSimpleRouteJson,
} from "high-density-repair03/lib"
import { materializeRoutes } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { applyViaToPadClearanceRelaxation } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/viaToPadClearanceRelaxation"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import {
  getPipeline9RegionalRepairSearchBudget,
  getRegionalCandidate,
} from "./apply-pipeline9-regional-b01-repairs"
import type { PreloadedHighDensityRoute } from "./convert-preloaded-traces-to-hd-routes"
import { getPipeline9RouteCopperGeometry } from "./pipeline9-fixed-route-copper"
import {
  getPipeline9DrcErrors,
  getPipeline9RouteIndexByTraceId,
  type Pipeline9DrcError,
} from "./pipeline9-joint-drc-repair-utils"

type Pipeline9ViaPadClearanceRepairResult = {
  routes: HighDensityRoute[]
  errors: Pipeline9DrcError[]
  attemptedCandidateCount: number
  acceptedCandidateCount: number
  relaxationCandidateCount: number
  relaxationAcceptedCount: number
  transitionSlideCandidateCount: number
  transitionSlideAcceptedCount: number
  regionalCleanupCandidateCount: number
  regionalCleanupAcceptedCount: number
  candidateSearchCount: number
  candidateSearchBudget: number
  candidateSearchBudgetExhausted: boolean
  remainingViaPadIssueCount: number
}

type TransitionSite = {
  startIndex: number
  endIndex: number
  x: number
  y: number
  fromZ: number
  toZ: number
}

type ReferenceDrcSnapshot = {
  errors: Pipeline9DrcError[]
}

type ViaPadGroup = {
  routeIndexes: number[]
  violationKeys: ReadonlySet<string>
}

type RouteRegionIntersectionInterval = {
  startSegmentIndex: number
  endSegmentIndex: number
}

type RouteMutationBoundaryScope = {
  prefix: HighDensityRoute["route"]
  suffix: HighDensityRoute["route"]
}

const REGIONAL_CLEANUP_SIZES = [3, 4, 5, 6, 8]
const MAX_TRANSITION_SLIDE_CANDIDATES = 32
const MAX_VIA_PAD_CANDIDATE_SEARCH_BUDGET = 96
const POINT_EPSILON = 1e-9

const isSamePoint = (
  left: { x: number; y: number },
  right: { x: number; y: number },
): boolean =>
  Math.abs(left.x - right.x) <= POINT_EPSILON &&
  Math.abs(left.y - right.y) <= POINT_EPSILON

const isViaPadClearanceError = (error: Pipeline9DrcError): boolean =>
  error.type === "pcb_pad_pad_clearance_error" &&
  Array.isArray(error.pcb_via_ids) &&
  error.pcb_via_ids.length === 1 &&
  typeof error.pcb_trace_id === "string"

export const countPipeline9ViaPadClearanceErrors = (
  errors: Pipeline9DrcError[],
): number => errors.filter(isViaPadClearanceError).length

const getViaPadViolationKey = (
  error: Pipeline9DrcError,
): string | undefined => {
  if (!isViaPadClearanceError(error)) return undefined
  const viaIds = new Set(
    (error.pcb_via_ids as unknown[]).filter(
      (viaId): viaId is string => typeof viaId === "string",
    ),
  )
  const padIds = Array.isArray(error.pcb_pad_ids)
    ? error.pcb_pad_ids.filter(
        (padId): padId is string =>
          typeof padId === "string" && !viaIds.has(padId),
      )
    : []
  return `${error.pcb_trace_id}:${padIds.sort().join(",")}`
}

const countTargetedViaPadViolations = (
  errors: Pipeline9DrcError[],
  violationKeys: ReadonlySet<string>,
): number =>
  errors.reduce((count, error) => {
    const key = getViaPadViolationKey(error)
    return count + (key && violationKeys.has(key) ? 1 : 0)
  }, 0)

const getErrorCenter = (
  error: Pipeline9DrcError,
): { x: number; y: number } | undefined => {
  const center = error.center ?? error.pcb_center
  if (!center || typeof center !== "object") return undefined
  const record = center as Record<string, unknown>
  return typeof record.x === "number" && typeof record.y === "number"
    ? { x: record.x, y: record.y }
    : undefined
}

const ERROR_ID_KEYS = [
  "pcb_trace_error_id",
  "pcb_via_trace_clearance_error_id",
  "pcb_pad_trace_clearance_error_id",
  "pcb_error_id",
] as const
const VIA_PARTICIPANT_ID_KEYS = new Set(["pcb_via_id", "pcb_via_ids"])

const isGeneratedViaId = (value: string): boolean => /^via_\d+$/.test(value)

const getStableInvolvedIds = ({
  error,
  omitErrorIds,
  omitGeneratedViaIds,
}: {
  error: Pipeline9DrcError
  omitErrorIds: boolean
  omitGeneratedViaIds: boolean
}): Record<string, string | string[]> =>
  Object.fromEntries(
    Object.entries(error)
      .filter(
        ([key, value]) =>
          /(?:_id|_ids|Id|Ids)$/.test(key) &&
          (!omitErrorIds ||
            !ERROR_ID_KEYS.includes(key as (typeof ERROR_ID_KEYS)[number])) &&
          (typeof value === "string" || Array.isArray(value)),
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([key, value]) => {
        const rawIds: unknown[] =
          typeof value === "string"
            ? [value]
            : Array.isArray(value)
              ? value
              : []
        const ids = rawIds
          .filter((item): item is string => typeof item === "string")
          .filter(
            (item) =>
              !omitGeneratedViaIds ||
              !VIA_PARTICIPANT_ID_KEYS.has(key) ||
              !isGeneratedViaId(item),
          )
          .sort()
        if (ids.length === 0) return []
        return [[key, typeof value === "string" ? ids[0]! : ids] as const]
      }),
  )

const errorHasGeneratedViaIdentity = (error: Pipeline9DrcError): boolean =>
  [
    ...(typeof error.pcb_via_id === "string" ? [error.pcb_via_id] : []),
    ...(Array.isArray(error.pcb_via_ids) ? error.pcb_via_ids : []),
  ].some((value) => typeof value === "string" && isGeneratedViaId(value))

const getStableViaParticipantIdentity = (error: Pipeline9DrcError): string => {
  const center = getErrorCenter(error)
  return JSON.stringify({
    involvedIds: getStableInvolvedIds({
      error,
      omitErrorIds: true,
      omitGeneratedViaIds: true,
    }),
    center: center
      ? {
          x: Math.round(center.x * 1e6) / 1e6,
          y: Math.round(center.y * 1e6) / 1e6,
        }
      : undefined,
    netRelation:
      typeof error.pcb_via_pair_net_relation === "string"
        ? error.pcb_via_pair_net_relation
        : undefined,
  })
}

const getStableDrcIdentity = (error: Pipeline9DrcError): string => {
  if (isViaPadClearanceError(error)) {
    return `${error.type}:${getViaPadViolationKey(error)}`
  }
  const errorId = ERROR_ID_KEYS.map((key) => error[key]).find(
    (value): value is string => typeof value === "string",
  )
  if (errorHasGeneratedViaIdentity(error)) {
    return `${error.type}:${getStableViaParticipantIdentity(error)}`
  }
  if (errorId) return `${error.type}:${errorId}`
  return `${error.type}:${JSON.stringify(
    getStableInvolvedIds({
      error,
      omitErrorIds: false,
      omitGeneratedViaIds: false,
    }),
  )}`
}

const hasNoNewDrcIdentities = (
  candidateErrors: Pipeline9DrcError[],
  currentErrors: Pipeline9DrcError[],
): boolean => {
  const currentIdentities = new Set(currentErrors.map(getStableDrcIdentity))
  return candidateErrors.every((error) =>
    currentIdentities.has(getStableDrcIdentity(error)),
  )
}

const getDrcErrorSeverity = (error: Pipeline9DrcError): number => {
  if (
    typeof error.actual_clearance === "number" &&
    typeof error.minimum_clearance === "number"
  ) {
    return Math.max(0, error.minimum_clearance - error.actual_clearance)
  }
  const message = typeof error.message === "string" ? error.message : ""
  const gap = message.match(/gap: (-?\d+(?:\.\d+)?)mm/)
  return gap ? -Number.parseFloat(gap[1]!) : 1
}

const retainedDrcIdentitiesAreNoWorse = (
  candidateErrors: Pipeline9DrcError[],
  currentErrors: Pipeline9DrcError[],
): boolean => {
  const getIdentityStats = (
    errors: Pipeline9DrcError[],
  ): Map<string, { count: number; worstSeverity: number }> => {
    const statsByIdentity = new Map<
      string,
      { count: number; worstSeverity: number }
    >()
    for (const error of errors) {
      const identity = getStableDrcIdentity(error)
      const current = statsByIdentity.get(identity)
      const severity = getDrcErrorSeverity(error)
      statsByIdentity.set(identity, {
        count: (current?.count ?? 0) + 1,
        worstSeverity: Math.max(current?.worstSeverity ?? -Infinity, severity),
      })
    }
    return statsByIdentity
  }
  const currentStatsByIdentity = getIdentityStats(currentErrors)
  const candidateStatsByIdentity = getIdentityStats(candidateErrors)
  return [...candidateStatsByIdentity].every(([identity, candidateStats]) => {
    const currentStats = currentStatsByIdentity.get(identity)
    return (
      currentStats !== undefined &&
      candidateStats.count <= currentStats.count &&
      candidateStats.worstSeverity <= currentStats.worstSeverity + 1e-9
    )
  })
}

const getReferenceDrcSnapshot = (
  evaluator: DrcEvaluator,
  routes: HighDensityRoute[],
): ReferenceDrcSnapshot => {
  const result = evaluator({ traces: [], routes, hdRoutes: routes })
  const errors = Array.isArray(result)
    ? result
    : (result.errorsWithCenters ?? result.errors)
  return { errors: errors as Pipeline9DrcError[] }
}

const endpointsAreUnchanged = (
  candidateRoutes: HighDensityRoute[],
  currentRoutes: HighDensityRoute[],
): boolean =>
  candidateRoutes.length === currentRoutes.length &&
  candidateRoutes.every((candidateRoute, routeIndex) => {
    const currentRoute = currentRoutes[routeIndex]
    if (!currentRoute) return false
    const candidateStart = candidateRoute.route[0]
    const currentStart = currentRoute.route[0]
    const candidateEnd = candidateRoute.route.at(-1)
    const currentEnd = currentRoute.route.at(-1)
    if (!candidateStart || !currentStart || !candidateEnd || !currentEnd) {
      return false
    }
    return (
      isSamePoint(candidateStart, currentStart) &&
      candidateStart.z === currentStart.z &&
      candidateStart.pcb_port_id === currentStart.pcb_port_id &&
      isSamePoint(candidateEnd, currentEnd) &&
      candidateEnd.z === currentEnd.z &&
      candidateEnd.pcb_port_id === currentEnd.pcb_port_id
    )
  })

const routePcbPortsAreUnchanged = (
  candidateRoutes: HighDensityRoute[],
  currentRoutes: HighDensityRoute[],
): boolean =>
  candidateRoutes.length === currentRoutes.length &&
  candidateRoutes.every((candidateRoute, routeIndex) => {
    const currentRoute = currentRoutes[routeIndex]
    if (!currentRoute) return false
    return (
      JSON.stringify(
        candidateRoute.route.filter((point) => point.pcb_port_id),
      ) ===
      JSON.stringify(currentRoute.route.filter((point) => point.pcb_port_id))
    )
  })

const routeThroughObstacleSegmentsAreUnchanged = (
  candidateRoutes: HighDensityRoute[],
  currentRoutes: HighDensityRoute[],
): boolean =>
  candidateRoutes.length === currentRoutes.length &&
  candidateRoutes.every((candidateRoute, routeIndex) => {
    const currentRoute = currentRoutes[routeIndex]
    if (!currentRoute) return false
    const getThroughObstacleSegments = (
      route: HighDensityRoute,
    ): Array<
      readonly [
        HighDensityRoute["route"][number],
        HighDensityRoute["route"][number],
      ]
    > =>
      route.route
        .slice(0, -1)
        .flatMap((point, pointIndex) =>
          point.toNextSegmentType === "through_obstacle"
            ? [[point, route.route[pointIndex + 1]!] as const]
            : [],
        )
    return (
      JSON.stringify(getThroughObstacleSegments(candidateRoute)) ===
      JSON.stringify(getThroughObstacleSegments(currentRoute))
    )
  })

const routeJumperPadGeometryIsUnchanged = (
  candidateRoutes: HighDensityRoute[],
  currentRoutes: HighDensityRoute[],
): boolean =>
  candidateRoutes.length === currentRoutes.length &&
  candidateRoutes.every((candidateRoute, routeIndex) => {
    const currentRoute = currentRoutes[routeIndex]
    if (!currentRoute) return false
    const getJumperPadGeometry = (route: HighDensityRoute): unknown => ({
      taggedPoints: route.route.filter((point) => point.insideJumperPad),
      touchingSegments: route.route
        .slice(0, -1)
        .flatMap((point, pointIndex) => {
          const next = route.route[pointIndex + 1]!
          return point.insideJumperPad || next.insideJumperPad
            ? [[point, next] as const]
            : []
        }),
    })
    return (
      JSON.stringify(getJumperPadGeometry(candidateRoute)) ===
      JSON.stringify(getJumperPadGeometry(currentRoute))
    )
  })

const viaOverlapsObstacle = ({
  via,
  obstacle,
  layerCount,
}: {
  via: ReturnType<typeof getPipeline9RouteCopperGeometry>["viaSpans"][number]
  obstacle: SimpleRouteJson["obstacles"][number]
  layerCount: number
}): boolean => {
  const obstacleZ = new Set(
    obstacle.__zLayers ??
      obstacle.zLayers ??
      obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount)),
  )
  if (![...obstacleZ].some((z) => z >= via.minZ && z <= via.maxZ)) {
    return false
  }
  const rotation = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const dx = via.center.x - obstacle.center.x
  const dy = via.center.y - obstacle.center.y
  const localX = dx * Math.cos(rotation) + dy * Math.sin(rotation)
  const localY = -dx * Math.sin(rotation) + dy * Math.cos(rotation)
  const distanceX = Math.max(Math.abs(localX) - obstacle.width / 2, 0)
  const distanceY = Math.max(Math.abs(localY) - obstacle.height / 2, 0)
  return Math.hypot(distanceX, distanceY) <= via.diameter / 2 + POINT_EPSILON
}

const getViaInPadOverlapKeys = ({
  routes,
  srj,
  routeIndexes,
}: {
  routes: HighDensityRoute[]
  srj: Pick<SimpleRouteJson, "layerCount" | "obstacles">
  routeIndexes: ReadonlySet<number>
}): Set<string> => {
  const obstacles = srj.obstacles
    .map((obstacle, obstacleIndex) => ({ obstacle, obstacleIndex }))
    .filter(({ obstacle }) => obstacle.isCopperPour !== true)
  const overlapKeys = new Set<string>()
  routes.forEach((route, routeIndex) => {
    if (!routeIndexes.has(routeIndex)) return
    for (const via of getPipeline9RouteCopperGeometry(route).viaSpans) {
      for (const { obstacle, obstacleIndex } of obstacles) {
        if (
          !viaOverlapsObstacle({ via, obstacle, layerCount: srj.layerCount })
        ) {
          continue
        }
        overlapKeys.add(
          `${routeIndex}:${via.center.x.toFixed(6)},${via.center.y.toFixed(6)}:${obstacle.obstacleId ?? obstacleIndex}`,
        )
      }
    }
  })
  return overlapKeys
}

const candidateIntroducesViaInPad = ({
  candidateRoutes,
  currentRoutes,
  srj,
  mutableRouteIndexes,
}: {
  candidateRoutes: HighDensityRoute[]
  currentRoutes: HighDensityRoute[]
  srj: Pick<SimpleRouteJson, "allowViaInPad" | "layerCount" | "obstacles">
  mutableRouteIndexes: ReadonlySet<number>
}): boolean => {
  if (srj.allowViaInPad === true) return false
  const currentOverlapKeys = getViaInPadOverlapKeys({
    routes: currentRoutes,
    srj,
    routeIndexes: mutableRouteIndexes,
  })
  return [
    ...getViaInPadOverlapKeys({
      routes: candidateRoutes,
      srj,
      routeIndexes: mutableRouteIndexes,
    }),
  ].some((key) => !currentOverlapKeys.has(key))
}

const routeTransitionsAreCoLocated = (route: HighDensityRoute): boolean =>
  route.route.slice(0, -1).every((point, pointIndex) => {
    const next = route.route[pointIndex + 1]!
    return point.z === next.z || isSamePoint(point, next)
  })

const pointIsByteIdentical = (
  left: HighDensityRoute["route"][number],
  right: HighDensityRoute["route"][number],
): boolean => JSON.stringify(left) === JSON.stringify(right)

const routeIsByteIdentical = (
  left: HighDensityRoute,
  right: HighDensityRoute,
): boolean => JSON.stringify(left) === JSON.stringify(right)

const routeHasExactPrefixAndSuffix = (
  candidateRoute: HighDensityRoute,
  currentRoute: HighDensityRoute,
): boolean => {
  const maxSharedLength = Math.min(
    candidateRoute.route.length,
    currentRoute.route.length,
  )
  let prefixLength = 0
  while (
    prefixLength < maxSharedLength &&
    pointIsByteIdentical(
      candidateRoute.route[prefixLength]!,
      currentRoute.route[prefixLength]!,
    )
  ) {
    prefixLength++
  }
  let suffixLength = 0
  while (
    suffixLength < maxSharedLength - prefixLength &&
    pointIsByteIdentical(
      candidateRoute.route[candidateRoute.route.length - suffixLength - 1]!,
      currentRoute.route[currentRoute.route.length - suffixLength - 1]!,
    )
  ) {
    suffixLength++
  }
  return prefixLength > 0 && suffixLength > 0
}

const routeIsExactOutsideSegmentInterval = ({
  candidateRoute,
  currentRoute,
  interval,
}: {
  candidateRoute: HighDensityRoute
  currentRoute: HighDensityRoute
  interval: RouteRegionIntersectionInterval
}): boolean => {
  const startPointIndex = interval.startSegmentIndex
  const endPointIndex = interval.endSegmentIndex + 1
  if (
    startPointIndex < 0 ||
    endPointIndex >= currentRoute.route.length ||
    endPointIndex <= startPointIndex
  ) {
    return false
  }
  const prefix = currentRoute.route.slice(0, startPointIndex + 1)
  const suffix = currentRoute.route.slice(endPointIndex)
  if (candidateRoute.route.length < prefix.length + suffix.length) return false
  return (
    prefix.every((point, pointIndex) =>
      pointIsByteIdentical(point, candidateRoute.route[pointIndex]!),
    ) &&
    suffix.every((point, suffixIndex) =>
      pointIsByteIdentical(
        point,
        candidateRoute.route[
          candidateRoute.route.length - suffix.length + suffixIndex
        ]!,
      ),
    )
  )
}

const routeMatchesMutationBoundaryScope = ({
  route,
  scope,
}: {
  route: HighDensityRoute
  scope: RouteMutationBoundaryScope
}): boolean =>
  route.route.length >= scope.prefix.length + scope.suffix.length &&
  scope.prefix.every((point, pointIndex) =>
    pointIsByteIdentical(point, route.route[pointIndex]!),
  ) &&
  scope.suffix.every((point, suffixIndex) =>
    pointIsByteIdentical(
      point,
      route.route[route.route.length - scope.suffix.length + suffixIndex]!,
    ),
  )

const getRouteMutationBoundaryScope = ({
  slideRoute,
  currentRoute,
  interval,
}: {
  slideRoute: HighDensityRoute
  currentRoute: HighDensityRoute
  interval: RouteRegionIntersectionInterval
}): RouteMutationBoundaryScope | undefined => {
  if (
    interval.startSegmentIndex < 0 ||
    interval.endSegmentIndex < interval.startSegmentIndex ||
    interval.endSegmentIndex >= slideRoute.route.length - 1
  ) {
    return undefined
  }
  const scope = {
    prefix: slideRoute.route.slice(0, interval.startSegmentIndex + 1),
    suffix: slideRoute.route.slice(interval.endSegmentIndex + 1),
  }
  return routeMatchesMutationBoundaryScope({ route: currentRoute, scope })
    ? scope
    : undefined
}

const routeMutationIsScoped = ({
  candidateRoutes,
  currentRoutes,
  mutableRouteIndexes,
  mutableRouteIntervals,
  mutableRouteBoundaryScopes,
}: {
  candidateRoutes: HighDensityRoute[]
  currentRoutes: HighDensityRoute[]
  mutableRouteIndexes: ReadonlySet<number>
  mutableRouteIntervals?: ReadonlyMap<number, RouteRegionIntersectionInterval>
  mutableRouteBoundaryScopes?: ReadonlyMap<number, RouteMutationBoundaryScope>
}): boolean =>
  candidateRoutes.length === currentRoutes.length &&
  candidateRoutes.every((candidateRoute, routeIndex) => {
    const currentRoute = currentRoutes[routeIndex]
    if (!currentRoute) return false
    if (!mutableRouteIndexes.has(routeIndex)) {
      return candidateRoute === currentRoute
    }
    return (
      routeTransitionsAreCoLocated(candidateRoute) &&
      (mutableRouteBoundaryScopes?.has(routeIndex)
        ? routeMatchesMutationBoundaryScope({
            route: candidateRoute,
            scope: mutableRouteBoundaryScopes.get(routeIndex)!,
          })
        : mutableRouteIntervals?.has(routeIndex)
          ? routeIsExactOutsideSegmentInterval({
              candidateRoute,
              currentRoute,
              interval: mutableRouteIntervals.get(routeIndex)!,
            })
          : routeHasExactPrefixAndSuffix(candidateRoute, currentRoute))
    )
  })

export const isPipeline9ViaPadIndexedCandidateSafe = ({
  candidateRoutes,
  candidateErrors,
  currentRoutes,
  currentErrors,
  mutableRouteIndexes,
  targetedViolationKeys,
  srj,
  mutableRouteIntervals,
  mutableRouteBoundaryScopes,
}: {
  candidateRoutes: HighDensityRoute[]
  candidateErrors: Pipeline9DrcError[]
  currentRoutes: HighDensityRoute[]
  currentErrors: Pipeline9DrcError[]
  mutableRouteIndexes: ReadonlySet<number>
  targetedViolationKeys: ReadonlySet<string>
  srj: Pick<SimpleRouteJson, "allowViaInPad" | "layerCount" | "obstacles">
  mutableRouteIntervals?: ReadonlyMap<number, RouteRegionIntersectionInterval>
  mutableRouteBoundaryScopes?: ReadonlyMap<number, RouteMutationBoundaryScope>
}): boolean =>
  countTargetedViaPadViolations(candidateErrors, targetedViolationKeys) <
    countTargetedViaPadViolations(currentErrors, targetedViolationKeys) &&
  countPipeline9ViaPadClearanceErrors(candidateErrors) <
    countPipeline9ViaPadClearanceErrors(currentErrors) &&
  candidateErrors.length < currentErrors.length &&
  hasNoNewDrcIdentities(candidateErrors, currentErrors) &&
  retainedDrcIdentitiesAreNoWorse(candidateErrors, currentErrors) &&
  endpointsAreUnchanged(candidateRoutes, currentRoutes) &&
  routePcbPortsAreUnchanged(candidateRoutes, currentRoutes) &&
  routeThroughObstacleSegmentsAreUnchanged(candidateRoutes, currentRoutes) &&
  routeJumperPadGeometryIsUnchanged(candidateRoutes, currentRoutes) &&
  !candidateIntroducesViaInPad({
    candidateRoutes,
    currentRoutes,
    srj,
    mutableRouteIndexes,
  }) &&
  routeMutationIsScoped({
    candidateRoutes,
    currentRoutes,
    mutableRouteIndexes,
    mutableRouteIntervals,
    mutableRouteBoundaryScopes,
  })

export const isPipeline9ViaPadReferenceCandidateSafe = ({
  candidateErrors,
  currentErrors,
}: {
  candidateErrors: Pipeline9DrcError[]
  currentErrors: Pipeline9DrcError[]
}): boolean =>
  candidateErrors.length <= currentErrors.length &&
  hasNoNewDrcIdentities(candidateErrors, currentErrors) &&
  retainedDrcIdentitiesAreNoWorse(candidateErrors, currentErrors)

const getTransitionSites = (route: HighDensityRoute): TransitionSite[] => {
  const sites: TransitionSite[] = []
  for (let pointIndex = 0; pointIndex < route.route.length - 1; pointIndex++) {
    const current = route.route[pointIndex]!
    const next = route.route[pointIndex + 1]!
    if (current.z === next.z || !isSamePoint(current, next)) continue
    let startIndex = pointIndex
    let endIndex = pointIndex + 1
    while (
      startIndex > 0 &&
      isSamePoint(route.route[startIndex - 1]!, current)
    ) {
      startIndex--
    }
    while (
      endIndex < route.route.length - 1 &&
      isSamePoint(route.route[endIndex + 1]!, current)
    ) {
      endIndex++
    }
    if (
      sites.some(
        (site) => site.startIndex === startIndex && site.endIndex === endIndex,
      )
    ) {
      continue
    }
    sites.push({
      startIndex,
      endIndex,
      x: current.x,
      y: current.y,
      fromZ: route.route[startIndex]!.z,
      toZ: route.route[endIndex]!.z,
    })
  }
  return sites
}

const getNearestTransitionSite = (
  route: HighDensityRoute,
  error: Pipeline9DrcError,
): TransitionSite | undefined => {
  const center = getErrorCenter(error)
  if (!center) return undefined
  return getTransitionSites(route).sort(
    (left, right) =>
      Math.hypot(left.x - center.x, left.y - center.y) -
      Math.hypot(right.x - center.x, right.y - center.y),
  )[0]
}

const getViaPadGroups = ({
  errors,
  routes,
  routeIndexByTraceId,
}: {
  errors: Pipeline9DrcError[]
  routes: HighDensityRoute[]
  routeIndexByTraceId: ReadonlyMap<string, number>
}): ViaPadGroup[] => {
  const groupsBySite = new Map<
    string,
    { routeIndexes: Set<number>; violationKeys: Set<string> }
  >()
  for (const error of errors.filter(isViaPadClearanceError)) {
    const routeIndex = routeIndexByTraceId.get(error.pcb_trace_id as string)
    const route = routeIndex === undefined ? undefined : routes[routeIndex]
    const site = route ? getNearestTransitionSite(route, error) : undefined
    if (routeIndex === undefined || !site) continue
    const key = `${site.x.toFixed(6)},${site.y.toFixed(6)}`
    const group = groupsBySite.get(key) ?? {
      routeIndexes: new Set<number>(),
      violationKeys: new Set<string>(),
    }
    group.routeIndexes.add(routeIndex)
    const violationKey = getViaPadViolationKey(error)
    if (violationKey) group.violationKeys.add(violationKey)
    groupsBySite.set(key, group)
  }
  return [...groupsBySite.values()].map((group) => ({
    routeIndexes: [...group.routeIndexes],
    violationKeys: group.violationKeys,
  }))
}

const preserveWireSegmentStartMetadata = ({
  candidateRoute,
  sourceRoute,
}: {
  candidateRoute: HighDensityRoute
  sourceRoute: HighDensityRoute
}): HighDensityRoute | undefined => {
  const getWireSegmentStartIndexes = (route: HighDensityRoute): number[] =>
    route.route
      .slice(0, -1)
      .flatMap((point, pointIndex) =>
        isSamePoint(point, route.route[pointIndex + 1]!) ? [] : [pointIndex],
      )
  const sourceStartIndexes = getWireSegmentStartIndexes(sourceRoute)
  const candidateStartIndexes = getWireSegmentStartIndexes(candidateRoute)
  if (sourceStartIndexes.length !== candidateStartIndexes.length) {
    return undefined
  }
  const candidatePoints = candidateRoute.route.map((point) => ({ ...point }))
  for (const [wireIndex, sourceStartIndex] of sourceStartIndexes.entries()) {
    const candidateStartIndex = candidateStartIndexes[wireIndex]
    if (candidateStartIndex === undefined) return undefined
    const sourceStart = sourceRoute.route[sourceStartIndex]!
    const sourceEnd = sourceRoute.route[sourceStartIndex + 1]!
    const candidateStart = candidatePoints[candidateStartIndex]!
    const candidateEnd = candidatePoints[candidateStartIndex + 1]!
    if (
      !isSamePoint(sourceStart, candidateStart) ||
      !isSamePoint(sourceEnd, candidateEnd)
    ) {
      return undefined
    }
    candidatePoints[candidateStartIndex] = {
      ...sourceStart,
      x: candidateStart.x,
      y: candidateStart.y,
      z: candidateStart.z,
    }
    candidatePoints[candidateStartIndex + 1] = {
      ...candidateEnd,
      traceThickness: sourceEnd.traceThickness,
    }
  }
  const candidateWithMetadata = { ...candidateRoute, route: candidatePoints }
  const sourceWireSegments =
    getPipeline9RouteCopperGeometry(sourceRoute).wireSegments
  const candidateWireSegments = getPipeline9RouteCopperGeometry(
    candidateWithMetadata,
  ).wireSegments
  if (
    sourceWireSegments.length !== candidateWireSegments.length ||
    sourceWireSegments.some((sourceSegment, segmentIndex) => {
      const candidateSegment = candidateWireSegments[segmentIndex]
      return (
        !candidateSegment ||
        !isSamePoint(sourceSegment.start, candidateSegment.start) ||
        !isSamePoint(sourceSegment.end, candidateSegment.end) ||
        Math.abs(sourceSegment.width - candidateSegment.width) > POINT_EPSILON
      )
    })
  ) {
    return undefined
  }
  return candidateWithMetadata
}

const moveTransitionBackward = ({
  route,
  site,
  targetIndex,
}: {
  route: HighDensityRoute
  site: TransitionSite
  targetIndex: number
}): HighDensityRoute | undefined => {
  const target = route.route[targetIndex]!
  const relocatedTransitionSuffix = route.route
    .slice(site.startIndex + 1, site.endIndex + 1)
    .map((point) => ({ ...point, x: target.x, y: target.y }))
  const oldSitePair = [
    { ...route.route[site.startIndex]!, z: site.toZ },
    { ...route.route[site.endIndex]!, z: site.toZ },
  ]
  const candidateRoute = materializeRoutes([
    {
      ...route,
      route: [
        ...route.route.slice(0, targetIndex + 1).map((point) => ({ ...point })),
        ...relocatedTransitionSuffix,
        ...route.route
          .slice(targetIndex + 1, site.startIndex)
          .map((point) => ({ ...point, z: site.toZ })),
        ...oldSitePair,
        ...route.route.slice(site.endIndex + 1).map((point) => ({ ...point })),
      ],
      vias: route.vias.map((via) => ({ ...via })),
    },
  ])[0]!
  return preserveWireSegmentStartMetadata({
    candidateRoute,
    sourceRoute: route,
  })
}

const moveTransitionForward = ({
  route,
  site,
  targetIndex,
}: {
  route: HighDensityRoute
  site: TransitionSite
  targetIndex: number
}): HighDensityRoute | undefined => {
  const target = route.route[targetIndex]!
  const oldSitePair = [
    { ...route.route[site.startIndex]!, z: site.fromZ },
    { ...route.route[site.endIndex]!, z: site.fromZ },
  ]
  const relocatedTransition = route.route
    .slice(site.startIndex, site.endIndex + 1)
    .map((point) => ({ ...point, x: target.x, y: target.y }))
  const candidateRoute = materializeRoutes([
    {
      ...route,
      route: [
        ...route.route.slice(0, site.startIndex).map((point) => ({ ...point })),
        ...oldSitePair,
        ...route.route
          .slice(site.endIndex + 1, targetIndex)
          .map((point) => ({ ...point, z: site.fromZ })),
        ...relocatedTransition,
        ...route.route.slice(targetIndex + 1).map((point) => ({ ...point })),
      ],
      vias: route.vias.map((via) => ({ ...via })),
    },
  ])[0]!
  return preserveWireSegmentStartMetadata({
    candidateRoute,
    sourceRoute: route,
  })
}

export const getTransitionSlideRoutes = ({
  routes,
  routeIndex,
  site,
}: {
  routes: HighDensityRoute[]
  routeIndex: number
  site: TransitionSite
}): HighDensityRoute[][] => {
  const route = routes[routeIndex]
  if (!route) return []
  if (
    route.route
      .slice(site.startIndex, site.endIndex + 1)
      .some(
        (point) =>
          point.pcb_port_id ||
          point.insideJumperPad ||
          point.toNextSegmentType === "through_obstacle",
      )
  ) {
    return []
  }
  const allSites = getTransitionSites(route)
  const previousSite = allSites
    .filter((candidate) => candidate.endIndex < site.startIndex)
    .at(-1)
  const nextSite = allSites.find(
    (candidate) => candidate.startIndex > site.endIndex,
  )
  const candidates: HighDensityRoute[][] = []
  const firstBackwardIndex = (previousSite?.endIndex ?? -1) + 1
  for (
    let targetIndex = site.startIndex - 1;
    targetIndex >= firstBackwardIndex;
    targetIndex--
  ) {
    const target = route.route[targetIndex]
    if (
      !target ||
      target.pcb_port_id ||
      target.insideJumperPad ||
      target.z !== site.fromZ ||
      target.toNextSegmentType === "through_obstacle"
    ) {
      break
    }
    const candidate = [...routes]
    const movedRoute = moveTransitionBackward({
      route,
      site,
      targetIndex,
    })
    if (!movedRoute) continue
    candidate[routeIndex] = movedRoute
    candidates.push(candidate)
  }
  const lastForwardIndex = (nextSite?.startIndex ?? route.route.length) - 1
  for (
    let targetIndex = site.endIndex + 1;
    targetIndex <= lastForwardIndex;
    targetIndex++
  ) {
    const target = route.route[targetIndex]
    const previous = route.route[targetIndex - 1]
    if (
      !target ||
      !previous ||
      target.pcb_port_id ||
      target.insideJumperPad ||
      previous.insideJumperPad ||
      target.z !== site.toZ ||
      target.toNextSegmentType === "through_obstacle" ||
      previous.toNextSegmentType === "through_obstacle"
    ) {
      break
    }
    const candidate = [...routes]
    const movedRoute = moveTransitionForward({
      route,
      site,
      targetIndex,
    })
    if (!movedRoute) continue
    candidate[routeIndex] = movedRoute
    candidates.push(candidate)
  }
  return candidates.slice(0, MAX_TRANSITION_SLIDE_CANDIDATES)
}

const getOwnedNewErrorCenters = ({
  ownerTraceId,
  candidateErrors,
  currentErrors,
}: {
  ownerTraceId: string
  candidateErrors: Pipeline9DrcError[]
  currentErrors: Pipeline9DrcError[]
}): Array<{ x: number; y: number }> => {
  const currentIdentities = new Set(currentErrors.map(getStableDrcIdentity))
  const centers = candidateErrors
    .filter(
      (error) =>
        !currentIdentities.has(getStableDrcIdentity(error)) &&
        (error.pcb_trace_id === ownerTraceId ||
          (Array.isArray(error.pcb_trace_ids) &&
            error.pcb_trace_ids.includes(ownerTraceId))),
    )
    .flatMap((error) => {
      const center = getErrorCenter(error)
      return center ? [center] : []
    })
  const uniqueCenters = new Map<string, { x: number; y: number }>()
  for (const center of centers) {
    uniqueCenters.set(`${center.x.toFixed(6)},${center.y.toFixed(6)}`, center)
  }
  return [...uniqueCenters.values()]
}

const clipSegmentToRegion = ({
  start,
  end,
  bounds,
}: {
  start: HighDensityRoute["route"][number]
  end: HighDensityRoute["route"][number]
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
}): { entryT: number; exitT: number } | undefined => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  let entryT = 0
  let exitT = 1
  for (const [direction, distanceToBoundary] of [
    [-dx, start.x - bounds.minX],
    [dx, bounds.maxX - start.x],
    [-dy, start.y - bounds.minY],
    [dy, bounds.maxY - start.y],
  ] as const) {
    if (Math.abs(direction) <= POINT_EPSILON) {
      if (distanceToBoundary < -POINT_EPSILON) return undefined
      continue
    }
    const boundaryT = distanceToBoundary / direction
    if (direction < 0) {
      entryT = Math.max(entryT, boundaryT)
    } else {
      exitT = Math.min(exitT, boundaryT)
    }
    if (entryT > exitT + POINT_EPSILON) return undefined
  }
  return { entryT, exitT }
}

const getRouteRegionIntersectionIntervals = ({
  route,
  center,
  regionSize,
}: {
  route: HighDensityRoute
  center: { x: number; y: number }
  regionSize: number
}): RouteRegionIntersectionInterval[] => {
  const halfSize = regionSize / 2
  const bounds = {
    minX: center.x - halfSize,
    maxX: center.x + halfSize,
    minY: center.y - halfSize,
    maxY: center.y + halfSize,
  }
  const intervals: RouteRegionIntersectionInterval[] = []
  let previousClip: { entryT: number; exitT: number } | undefined
  for (let pointIndex = 0; pointIndex < route.route.length - 1; pointIndex++) {
    const clip = clipSegmentToRegion({
      start: route.route[pointIndex]!,
      end: route.route[pointIndex + 1]!,
      bounds,
    })
    if (!clip) {
      previousClip = undefined
      continue
    }
    const previousInterval = intervals.at(-1)
    const connectsToPreviousInterval =
      previousInterval?.endSegmentIndex === pointIndex - 1 &&
      previousClip !== undefined &&
      previousClip.exitT >= 1 - POINT_EPSILON &&
      clip.entryT <= POINT_EPSILON
    if (connectsToPreviousInterval) {
      previousInterval.endSegmentIndex = pointIndex
    } else {
      intervals.push({
        startSegmentIndex: pointIndex,
        endSegmentIndex: pointIndex,
      })
    }
    previousClip = clip
  }
  return intervals
}

export const routeIntersectsRegionInSingleInterval = ({
  route,
  center,
  regionSize,
}: {
  route: HighDensityRoute
  center: { x: number; y: number }
  regionSize: number
}): boolean => {
  return (
    getRouteRegionIntersectionIntervals({ route, center, regionSize })
      .length === 1
  )
}

const getOwnedTransitionExcursionInterval = ({
  route,
  intervals,
}: {
  route: HighDensityRoute
  intervals: RouteRegionIntersectionInterval[]
}): RouteRegionIntersectionInterval | undefined => {
  const firstInterval = intervals[0]
  const lastInterval = intervals.at(-1)
  if (!firstInterval || !lastInterval || intervals.length < 2) {
    return undefined
  }
  const ownedInterval = {
    startSegmentIndex: firstInterval.startSegmentIndex,
    endSegmentIndex: lastInterval.endSegmentIndex,
  }
  const ownedPoints = route.route.slice(
    ownedInterval.startSegmentIndex,
    ownedInterval.endSegmentIndex + 2,
  )
  if (
    ownedPoints.some((point) => point.pcb_port_id || point.insideJumperPad) ||
    ownedPoints
      .slice(0, -1)
      .some((point) => point.toNextSegmentType === "through_obstacle")
  ) {
    return undefined
  }
  const transitions = getTransitionSites(route).filter(
    (site) =>
      site.startIndex >= ownedInterval.startSegmentIndex &&
      site.endIndex <= ownedInterval.endSegmentIndex + 1,
  )
  if (transitions.length !== 2) return undefined
  const [firstTransition, secondTransition] = transitions
  if (
    !firstTransition ||
    !secondTransition ||
    firstTransition.startIndex > firstInterval.endSegmentIndex + 1 ||
    secondTransition.endIndex < lastInterval.startSegmentIndex ||
    firstTransition.fromZ !== secondTransition.toZ ||
    firstTransition.toZ !== secondTransition.fromZ ||
    route.route[ownedInterval.startSegmentIndex]!.z !== firstTransition.fromZ ||
    route.route[ownedInterval.endSegmentIndex + 1]!.z !== secondTransition.toZ
  ) {
    return undefined
  }
  return ownedInterval
}

const getRouteMutationInterval = (
  candidateRoute: HighDensityRoute,
  currentRoute: HighDensityRoute,
): RouteRegionIntersectionInterval | undefined => {
  const maxSharedLength = Math.min(
    candidateRoute.route.length,
    currentRoute.route.length,
  )
  let prefixLength = 0
  while (
    prefixLength < maxSharedLength &&
    pointIsByteIdentical(
      candidateRoute.route[prefixLength]!,
      currentRoute.route[prefixLength]!,
    )
  ) {
    prefixLength++
  }
  let suffixLength = 0
  while (
    suffixLength < maxSharedLength - prefixLength &&
    pointIsByteIdentical(
      candidateRoute.route[candidateRoute.route.length - suffixLength - 1]!,
      currentRoute.route[currentRoute.route.length - suffixLength - 1]!,
    )
  ) {
    suffixLength++
  }
  if (prefixLength === maxSharedLength) return undefined
  const startSegmentIndex = Math.max(0, prefixLength - 1)
  const endPointIndex = currentRoute.route.length - suffixLength
  if (endPointIndex <= startSegmentIndex) return undefined
  return {
    startSegmentIndex,
    endSegmentIndex: endPointIndex - 1,
  }
}

export const applyPipeline9ViaPadClearanceRepairs = ({
  srj,
  routes,
  fixedObstacleRoutes,
  newConnections,
  syntheticConnectionNames,
  drcEvaluator,
  referenceDrcEvaluator,
  initialErrors,
  initialReferenceErrors,
  connMap,
  colorMap,
  viaDiameter,
  traceWidth,
  obstacleMargin,
  effort,
}: {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  fixedObstacleRoutes: PreloadedHighDensityRoute[]
  newConnections: SimpleRouteConnection[]
  syntheticConnectionNames: ReadonlySet<string>
  drcEvaluator: DrcEvaluator
  referenceDrcEvaluator: DrcEvaluator
  initialErrors?: Pipeline9DrcError[]
  initialReferenceErrors?: Pipeline9DrcError[]
  connMap: ConnectivityMap
  colorMap: Record<string, string>
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  effort: number
}): Pipeline9ViaPadClearanceRepairResult => {
  const candidateSearchBudget = Math.min(
    MAX_VIA_PAD_CANDIDATE_SEARCH_BUDGET,
    getPipeline9RegionalRepairSearchBudget(routes.length),
  )
  let currentRoutes = routes
  let currentErrors =
    initialErrors ?? getPipeline9DrcErrors(drcEvaluator, currentRoutes)
  if (countPipeline9ViaPadClearanceErrors(currentErrors) === 0) {
    return {
      routes: currentRoutes,
      errors: currentErrors,
      attemptedCandidateCount: 0,
      acceptedCandidateCount: 0,
      relaxationCandidateCount: 0,
      relaxationAcceptedCount: 0,
      transitionSlideCandidateCount: 0,
      transitionSlideAcceptedCount: 0,
      regionalCleanupCandidateCount: 0,
      regionalCleanupAcceptedCount: 0,
      candidateSearchCount: 0,
      candidateSearchBudget,
      candidateSearchBudgetExhausted: false,
      remainingViaPadIssueCount: 0,
    }
  }
  let currentReferenceErrors =
    initialReferenceErrors ??
    getReferenceDrcSnapshot(referenceDrcEvaluator, currentRoutes).errors
  let attemptedCandidateCount = 0
  let acceptedCandidateCount = 0
  let relaxationCandidateCount = 0
  let relaxationAcceptedCount = 0
  let transitionSlideCandidateCount = 0
  let transitionSlideAcceptedCount = 0
  let regionalCleanupCandidateCount = 0
  let regionalCleanupAcceptedCount = 0
  let candidateSearchCount = 0

  const routeIndexByTraceId = getPipeline9RouteIndexByTraceId({
    routes: currentRoutes,
    newConnections,
    syntheticConnectionNames,
  })
  for (const { routeIndexes, violationKeys } of getViaPadGroups({
    errors: currentErrors,
    routes: currentRoutes,
    routeIndexByTraceId,
  })) {
    if (candidateSearchCount >= candidateSearchBudget) break
    candidateSearchCount++
    relaxationCandidateCount++
    const routeSubset = routeIndexes.map(
      (routeIndex) => currentRoutes[routeIndex]!,
    )
    const relaxedSubset = applyViaToPadClearanceRelaxation(
      {
        ...srj,
        minViaEdgeToPadEdgeClearance: srj.minViaEdgeToPadEdgeClearance ?? 0.1,
      } as unknown as RepairSimpleRouteJson,
      routeSubset,
      connMap,
    ) as HighDensityRoute[]
    if (
      relaxedSubset.every((route, index) =>
        routeIsByteIdentical(route, routeSubset[index]!),
      )
    ) {
      continue
    }
    attemptedCandidateCount++
    const candidateRoutes = [...currentRoutes]
    for (const [subsetIndex, routeIndex] of routeIndexes.entries()) {
      candidateRoutes[routeIndex] = relaxedSubset[subsetIndex]!
    }
    const candidateErrors = getPipeline9DrcErrors(drcEvaluator, candidateRoutes)
    if (
      !isPipeline9ViaPadIndexedCandidateSafe({
        candidateRoutes,
        candidateErrors,
        currentRoutes,
        currentErrors,
        mutableRouteIndexes: new Set(routeIndexes),
        targetedViolationKeys: violationKeys,
        srj,
      })
    ) {
      continue
    }
    const candidateReferenceErrors = getReferenceDrcSnapshot(
      referenceDrcEvaluator,
      candidateRoutes,
    ).errors
    if (
      isPipeline9ViaPadReferenceCandidateSafe({
        candidateErrors: candidateReferenceErrors,
        currentErrors: currentReferenceErrors,
      })
    ) {
      currentRoutes = candidateRoutes
      currentErrors = candidateErrors
      currentReferenceErrors = candidateReferenceErrors
      acceptedCandidateCount++
      relaxationAcceptedCount++
    }
  }

  while (candidateSearchCount < candidateSearchBudget) {
    const residualViaPadErrors = currentErrors.filter(isViaPadClearanceError)
    let acceptedResidualCandidate = false
    const currentRouteIndexByTraceId = getPipeline9RouteIndexByTraceId({
      routes: currentRoutes,
      newConnections,
      syntheticConnectionNames,
    })
    for (const error of residualViaPadErrors) {
      const violationKey = getViaPadViolationKey(error)
      if (!violationKey) continue
      const ownerTraceId = error.pcb_trace_id as string
      const routeIndex = currentRouteIndexByTraceId.get(ownerTraceId)
      const route =
        routeIndex === undefined ? undefined : currentRoutes[routeIndex]
      const site = route ? getNearestTransitionSite(route, error) : undefined
      if (routeIndex === undefined || !route || !site) continue
      const transitionSlideRoutes = getTransitionSlideRoutes({
        routes: currentRoutes,
        routeIndex,
        site,
      })
      for (const slideRoutes of transitionSlideRoutes) {
        if (candidateSearchCount >= candidateSearchBudget) break
        candidateSearchCount++
        attemptedCandidateCount++
        transitionSlideCandidateCount++
        const slideErrors = getPipeline9DrcErrors(drcEvaluator, slideRoutes)
        const targetedViolationKeys = new Set([violationKey])
        const slideMutationInterval = getRouteMutationInterval(
          slideRoutes[routeIndex]!,
          currentRoutes[routeIndex]!,
        )
        if (!slideMutationInterval) continue
        if (
          countTargetedViaPadViolations(slideErrors, targetedViolationKeys) >=
          countTargetedViaPadViolations(currentErrors, targetedViolationKeys)
        ) {
          continue
        }
        if (
          isPipeline9ViaPadIndexedCandidateSafe({
            candidateRoutes: slideRoutes,
            candidateErrors: slideErrors,
            currentRoutes,
            currentErrors,
            mutableRouteIndexes: new Set([routeIndex]),
            targetedViolationKeys,
            srj,
            mutableRouteIntervals: new Map([
              [routeIndex, slideMutationInterval],
            ]),
          })
        ) {
          const slideReferenceErrors = getReferenceDrcSnapshot(
            referenceDrcEvaluator,
            slideRoutes,
          ).errors
          if (
            isPipeline9ViaPadReferenceCandidateSafe({
              candidateErrors: slideReferenceErrors,
              currentErrors: currentReferenceErrors,
            })
          ) {
            currentRoutes = slideRoutes
            currentErrors = slideErrors
            currentReferenceErrors = slideReferenceErrors
            acceptedCandidateCount++
            transitionSlideAcceptedCount++
            acceptedResidualCandidate = true
            break
          }
        }
        const centers = getOwnedNewErrorCenters({
          ownerTraceId,
          candidateErrors: slideErrors,
          currentErrors,
        })
        for (const center of centers) {
          for (const regionSize of REGIONAL_CLEANUP_SIZES) {
            if (candidateSearchCount >= candidateSearchBudget) break
            const intersectionIntervals = getRouteRegionIntersectionIntervals({
              route: slideRoutes[routeIndex]!,
              center,
              regionSize,
            })
            if (intersectionIntervals.length === 0) continue
            const ownedSegmentInterval =
              intersectionIntervals.length === 1
                ? intersectionIntervals[0]!
                : getOwnedTransitionExcursionInterval({
                    route: slideRoutes[routeIndex]!,
                    intervals: intersectionIntervals,
                  })
            if (!ownedSegmentInterval) continue
            if (
              slideRoutes[routeIndex]!.route.slice(
                ownedSegmentInterval.startSegmentIndex,
                ownedSegmentInterval.endSegmentIndex + 2,
              ).some((point) => point.insideJumperPad)
            ) {
              continue
            }
            const mutationBoundaryScope = getRouteMutationBoundaryScope({
              slideRoute: slideRoutes[routeIndex]!,
              currentRoute: currentRoutes[routeIndex]!,
              interval: ownedSegmentInterval,
            })
            if (!mutationBoundaryScope) continue
            candidateSearchCount++
            regionalCleanupCandidateCount++
            const regionalCandidate = getRegionalCandidate({
              routes: slideRoutes,
              fixedObstacleRoutes,
              routeIndex,
              center,
              regionSize,
              srj,
              connMap,
              colorMap,
              viaDiameter,
              traceWidth,
              obstacleMargin,
              effort,
              ownedSegmentInterval,
            })
            if (!regionalCandidate) continue
            attemptedCandidateCount++
            const candidateErrors = getPipeline9DrcErrors(
              drcEvaluator,
              regionalCandidate.routes,
            )
            const indexedCandidateIsSafe =
              isPipeline9ViaPadIndexedCandidateSafe({
                candidateRoutes: regionalCandidate.routes,
                candidateErrors,
                currentRoutes,
                currentErrors,
                mutableRouteIndexes: new Set([routeIndex]),
                targetedViolationKeys,
                srj,
                mutableRouteBoundaryScopes: new Map([
                  [routeIndex, mutationBoundaryScope],
                ]),
              })
            if (!indexedCandidateIsSafe) {
              continue
            }
            const candidateReferenceErrors = getReferenceDrcSnapshot(
              referenceDrcEvaluator,
              regionalCandidate.routes,
            ).errors
            if (
              !isPipeline9ViaPadReferenceCandidateSafe({
                candidateErrors: candidateReferenceErrors,
                currentErrors: currentReferenceErrors,
              })
            ) {
              continue
            }
            currentRoutes = regionalCandidate.routes
            currentErrors = candidateErrors
            currentReferenceErrors = candidateReferenceErrors
            acceptedCandidateCount++
            regionalCleanupAcceptedCount++
            acceptedResidualCandidate = true
            break
          }
          if (acceptedResidualCandidate) break
        }
        if (acceptedResidualCandidate) break
      }
      if (acceptedResidualCandidate) break
    }
    if (!acceptedResidualCandidate) {
      break
    }
  }

  return {
    routes: currentRoutes,
    errors: currentErrors,
    attemptedCandidateCount,
    acceptedCandidateCount,
    relaxationCandidateCount,
    relaxationAcceptedCount,
    transitionSlideCandidateCount,
    transitionSlideAcceptedCount,
    regionalCleanupCandidateCount,
    regionalCleanupAcceptedCount,
    candidateSearchCount,
    candidateSearchBudget,
    candidateSearchBudgetExhausted:
      candidateSearchCount >= candidateSearchBudget &&
      countPipeline9ViaPadClearanceErrors(currentErrors) > 0,
    remainingViaPadIssueCount:
      countPipeline9ViaPadClearanceErrors(currentErrors),
  }
}
