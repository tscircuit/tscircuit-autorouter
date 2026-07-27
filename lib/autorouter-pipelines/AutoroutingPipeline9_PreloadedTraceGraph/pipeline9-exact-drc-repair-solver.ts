import {
  GlobalDrcBranchPortfolioSolver,
  type GlobalDrcBranchPortfolioSolverParams,
} from "high-density-repair03/lib"
import {
  applyDrcErrorForces,
  cloneRoutes,
  getDrcSnapshot,
  materializeRoutes,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import {
  type Pipeline9B01RerouteOptions,
  Pipeline9B01Rerouter,
} from "./pipeline9-b01-rerouter"

type Pipeline9ExactDrcRepairSolverParams =
  GlobalDrcBranchPortfolioSolverParams & {
    originalObstacles: Obstacle[]
    b01BaseObstacles: Obstacle[]
  }

type DrcError = Record<string, unknown>
type DrcSnapshot = ReturnType<typeof getDrcSnapshot>

type TerminalConstraint = {
  routeIndex: number
  endpoint: "start" | "end"
  originalPoint: HighDensityRoute["route"][number]
  traceRadius: number
  owningObstacles: Obstacle[]
}

type ViaTransitionGroup = {
  routeIndex: number
  indexes: number[]
  x: number
  y: number
  distanceToError: number
}

type ErrorOwnedClusterPlan = {
  routeIndexes: number[]
  reverse: boolean
  allowTerminalEscape: boolean
}

type PostFinalCompositeWindow = {
  startIndex: number
  endIndex: number
  terminalRooted: boolean
}

type FixedCopperCompositePlan = {
  routeIndex: number
  targetErrorIdentity: string
}

type AnchoredFixedCopperWindow = {
  routes: HighDensityRoute[]
  startIndex: number
  endIndex: number
}

type ScopedSameNetViaMergeResult = {
  routes?: HighDensityRoute[]
  iterations: number
  mergedViaCount: number
}

type SharedTerminalCompositeGroup = {
  fixedTraceId: string
  canonicalNet: string
  terminalPortId: string
  branches: Array<{
    routeIndex: number
    endpoint: "start" | "end"
  }>
  baselineErrorIds: Set<string>
}

type EndpointSlideBranch = {
  routeIndex: number
  endpoint: "start" | "end"
  endpointIndex: number
  coincidentIndexes: number[]
  constraint: TerminalConstraint
}

type FinalContinuityTerminalViaCandidate = {
  routeIndex: number
  endpoint: "start" | "end"
  targetZ: number
  distanceToError: number
}

const POSITION_EPSILON = 1e-6
const PRELOADED_TERMINAL_MATCH_TOLERANCE = 1e-3
const ENDPOINT_SLIDE_RADII = [
  0.025, 0.05, 0.075, 0.1, 0.125, 0.15, 0.2, 0.25, 0.3,
] as const
const VIA_MICRO_SHIFT_RADII = [...ENDPOINT_SLIDE_RADII, 0.4, 0.5, 0.75] as const
const MAX_VIA_GROUPS_PER_ROUTE = 3
const MAX_VIA_MICRO_SHIFT_DRC_EVALUATIONS_PER_SWEEP = 128
const MAX_VIA_MICRO_SHIFT_SNAPSHOT_ISSUES = 8
const BATCHED_TRACE_FORCE_SCALES = [4, 2, 1, 0.5, 0.25] as const
const MAX_BATCHED_TRACE_FORCE_PASSES = 20
const MAX_CLEANUP_PASSES = 8
const DEFAULT_MAX_LOCAL_CLEANUP_DRC_EVALUATIONS = 500
const HIGH_INITIAL_DRC_MAX_LOCAL_CLEANUP_DRC_EVALUATIONS = 150
const HIGH_INITIAL_DRC_THRESHOLD = 20
const DEFAULT_MAX_CONSECUTIVE_LOCAL_CLEANUP_DRC_MISSES =
  DEFAULT_MAX_LOCAL_CLEANUP_DRC_EVALUATIONS
const HIGH_INITIAL_DRC_MAX_CONSECUTIVE_LOCAL_CLEANUP_DRC_MISSES = 64
const MAX_LOCAL_LAYER_DETOUR_EXPANSION = 6
const MAX_B01_FULL_ATTEMPTS_PER_ROUND = 18
const MAX_B01_INTERIOR_ATTEMPTS_PER_ROUND = 48
const MAX_B01_FIXED_ONLY_ATTEMPTS_PER_ROUND = 8
const DEFAULT_MAX_B01_TOTAL_ITERATIONS = 300_000
const HIGH_INITIAL_DRC_MAX_B01_TOTAL_ITERATIONS = 200_000
const MAX_B01_FULL_ITERATIONS = 30_000
const MAX_B01_INTERIOR_ITERATIONS = 10_000
const MAX_B01_PHASE_ROUNDS = 2
const MAX_B01_INTERIOR_EXPANSION = 6
const MAX_ERROR_OWNED_CLUSTER_ITERATIONS = 75_000
const MAX_ERROR_OWNED_CLUSTER_ROUTE_ITERATIONS = 15_000
const MAX_ERROR_OWNED_CLUSTER_PASSES = 2
const MAX_ERROR_OWNED_CLUSTER_TERMINAL_ESCAPE_CANDIDATES = 4
const MAX_ERROR_OWNED_CLUSTER_TERMINAL_ESCAPE_ITERATIONS = 10_000
const MAX_POST_CLUSTER_VIA_MICRO_SHIFT_DRC_EVALUATIONS = 128
const MAX_FINAL_OWNER_B01_ITERATIONS = 50_000
const MAX_FINAL_OWNER_FULL_ROUTE_ITERATIONS = 25_000
const MAX_FINAL_OWNER_LONG_ROUTE_ITERATIONS = 4_000
const MAX_FINAL_OWNER_VARIANT_ITERATIONS = 10_000
const MAX_FINAL_OWNER_INTERIOR_ITERATIONS = 10_000
const MAX_FINAL_OWNER_FULL_VARIANT_ROUTE_POINTS = 24
const FINAL_OWNER_INTERIOR_ITERATION_RESERVE = 8_000
const MAX_FINAL_OWNER_FALLBACK_RESIDUAL = 2
const MAX_POST_REPAIR_SAME_NET_VIA_MERGER_ITERATIONS = 8
const MAX_SHARED_TERMINAL_COMPOSITE_RESIDUAL = 4
const MAX_SHARED_TERMINAL_COMPOSITE_ATTEMPTS = 1
const MAX_SHARED_TERMINAL_COMPOSITE_B01_ITERATIONS = 12_500
const MAX_SHARED_TERMINAL_COMPOSITE_DRC_EVALUATIONS = 2
const MAX_POST_FINAL_COMPOSITE_B01_ITERATIONS = 24_000
const MAX_POST_FINAL_COMPOSITE_B01_ITERATIONS_PER_ATTEMPT = 8_000
const MAX_POST_FINAL_COMPOSITE_ATTEMPTS = 12
const MAX_POST_FINAL_COMPOSITE_DRC_EVALUATIONS = 12
const MAX_POST_FINAL_COMPOSITE_SAME_NET_VIA_MERGER_ITERATIONS = 32
const MAX_POST_FINAL_COMPOSITE_SAME_NET_VIA_MERGER_ITERATIONS_PER_ATTEMPT = 8
const ANCHORED_FIXED_COPPER_HALF_SPAN = 7
const MAX_ANCHORED_FIXED_COPPER_ATTEMPTS = 96
const MAX_ANCHORED_FIXED_COPPER_DRC_EVALUATIONS = 48
const MAX_ANCHORED_FIXED_COPPER_ITERATIONS = 480_000
const MAX_ANCHORED_FIXED_COPPER_ITERATIONS_PER_ATTEMPT = 12_000
const MAX_FIXED_COPPER_COMPOSITE_RESIDUAL = 2
const MAX_FIXED_COPPER_COMPOSITE_PRIMARY_ATTEMPTS = 4
const MAX_FIXED_COPPER_COMPOSITE_FOLLOWUP_ATTEMPTS = 6
const MAX_FIXED_COPPER_COMPOSITE_DRC_EVALUATIONS = 8
const MAX_FIXED_COPPER_COMPOSITE_ITERATIONS = 24_000
const MAX_FIXED_COPPER_COMPOSITE_ITERATIONS_PER_ATTEMPT = 8_000
const MAX_FIXED_COPPER_COMPOSITE_EXPOSED_ISSUES = 4
const MAX_FIXED_COPPER_COMPOSITE_FOLLOWUP_OWNERS = 2
const MAX_FINAL_ENDPOINT_SLIDE_DRC_EVALUATIONS = 32
const MAX_FINAL_CONTINUITY_TERMINAL_VIA_ATTEMPTS = 32
const MAX_FINAL_CONTINUITY_TERMINAL_VIA_DRC_EVALUATIONS = 8
const MAX_EARLY_FIXED_OVERLAP_LAYER_DETOUR_DRC_EVALUATIONS = 128
const MAX_FINAL_FIXED_OVERLAP_LAYER_DETOUR_DRC_EVALUATIONS = 192
const POST_FINAL_COMPOSITE_INTERIOR_EXPANSIONS = [4, 8] as const
const POST_FINAL_COMPOSITE_TERMINAL_PROXIMITY = 4
const FULL_B01_VARIANTS = [
  { reverse: false, shortenPath: true },
  { reverse: false, shortenPath: false },
  { reverse: true, shortenPath: false },
] as const

const INTERIOR_B01_VARIANTS = [
  { reverse: false, shortenPath: false },
  { reverse: true, shortenPath: false },
] as const

const FIXED_ONLY_B01_VARIANTS = [
  { reverse: false, shortenPath: false },
  { reverse: true, shortenPath: false },
] as const

const FINAL_OWNER_FULL_VARIANTS = [
  { reverse: false, shortenPath: false },
  { reverse: false, shortenPath: true },
  { reverse: true, shortenPath: false },
] as const

const FIXED_COPPER_COMPOSITE_PRIMARY_VARIANTS = [
  { reverse: false, shortenPath: true },
  { reverse: false, shortenPath: false },
  { reverse: true, shortenPath: false },
] as const

const getErrorType = (error: DrcError): string | undefined =>
  typeof error.error_type === "string"
    ? error.error_type
    : typeof error.type === "string"
      ? error.type
      : undefined

const getPhysicalPadIdFromError = (error: DrcError): string | undefined => {
  if (typeof error.pcb_pad_id === "string") return error.pcb_pad_id
  if (typeof error.pcb_trace_error_id !== "string") return undefined
  return error.pcb_trace_error_id.match(/(pcb_(?:smtpad|plated_hole)_.+)$/)?.[1]
}

const getPointDistance = (
  left: Pick<HighDensityRoute["route"][number], "x" | "y">,
  right: Pick<HighDensityRoute["route"][number], "x" | "y">,
): number => Math.hypot(left.x - right.x, left.y - right.y)

const obstacleAppliesToLayer = (
  obstacle: Obstacle,
  z: number,
  layerCount: number,
): boolean => {
  if (obstacle.__zLayers?.includes(z)) {
    return true
  }
  return obstacle.layers.includes(mapZToLayerName(z, layerCount))
}

const pointFitsInsideObstacle = (
  point: Pick<HighDensityRoute["route"][number], "x" | "y">,
  obstacle: Obstacle,
  inset: number,
): boolean => {
  const radians = -((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const deltaX = point.x - obstacle.center.x
  const deltaY = point.y - obstacle.center.y
  const localX = deltaX * Math.cos(radians) - deltaY * Math.sin(radians)
  const localY = deltaX * Math.sin(radians) + deltaY * Math.cos(radians)
  const halfWidth = obstacle.width / 2 - inset
  const halfHeight = obstacle.height / 2 - inset
  if (halfWidth <= 0 || halfHeight <= 0) return false

  if (String(obstacle.type) === "oval") {
    return (
      (localX * localX) / (halfWidth * halfWidth) +
        (localY * localY) / (halfHeight * halfHeight) <=
      1 + POSITION_EPSILON
    )
  }

  return (
    Math.abs(localX) <= halfWidth + POSITION_EPSILON &&
    Math.abs(localY) <= halfHeight + POSITION_EPSILON
  )
}

const obstacleSharesRouteNet = (
  obstacle: Obstacle,
  route: HighDensityRoute,
): boolean =>
  obstacle.connectedTo.includes(
    route.rootConnectionName ?? route.connectionName,
  ) || obstacle.connectedTo.includes(route.connectionName)

const obstacleRepresentsPhysicalPad = (
  obstacle: Obstacle,
  padId: string,
): boolean => obstacle.connectedTo[0] === padId

const getOtherTraceId = (
  error: DrcError,
  traceRouteIndexById: Map<string, number>,
): string | undefined => {
  const traceId = error.pcb_trace_id
  const errorId = error.pcb_trace_error_id
  if (typeof traceId !== "string" || typeof errorId !== "string") {
    return undefined
  }
  const prefix = `overlap_${traceId}_`
  if (!errorId.startsWith(prefix)) return undefined
  const otherTraceId = errorId.slice(prefix.length)
  return traceRouteIndexById.has(otherTraceId) ? otherTraceId : undefined
}

const getRawOtherTraceId = (error: DrcError): string | undefined => {
  const traceId = error.pcb_trace_id
  const errorId = error.pcb_trace_error_id
  if (typeof traceId !== "string" || typeof errorId !== "string") {
    return undefined
  }
  const prefix = `overlap_${traceId}_`
  return errorId.startsWith(prefix) ? errorId.slice(prefix.length) : undefined
}

const getCandidateTraceIdsFromError = (error: DrcError): string[] =>
  Array.isArray(error.candidate_pcb_trace_ids)
    ? error.candidate_pcb_trace_ids.filter(
        (traceId): traceId is string => typeof traceId === "string",
      )
    : []

const getUnitDirection = (
  deltaX: number,
  deltaY: number,
): { x: number; y: number } | undefined => {
  const length = Math.hypot(deltaX, deltaY)
  if (length <= POSITION_EPSILON) return undefined
  return { x: deltaX / length, y: deltaY / length }
}

const getMicroShiftDirections = (preferredDirection?: {
  x: number
  y: number
}): Array<{ x: number; y: number }> => {
  const directions: Array<{ x: number; y: number }> = []
  const seenDirections = new Set<string>()
  const addDirection = (direction: { x: number; y: number } | undefined) => {
    if (!direction) return
    const unitDirection = getUnitDirection(direction.x, direction.y)
    if (!unitDirection) return
    const key = `${unitDirection.x.toFixed(6)}:${unitDirection.y.toFixed(6)}`
    if (seenDirections.has(key)) return
    seenDirections.add(key)
    directions.push(unitDirection)
  }

  addDirection(preferredDirection)
  for (const direction of [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: Math.SQRT1_2, y: Math.SQRT1_2 },
    { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
    { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
    { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
  ]) {
    addDirection(direction)
  }

  return directions
}

const routeHasValidLayerTransitions = (route: HighDensityRoute): boolean =>
  route.route.every((point, pointIndex) => {
    const nextPoint = route.route[pointIndex + 1]
    return (
      !nextPoint ||
      point.z === nextPoint.z ||
      getPointDistance(point, nextPoint) <= POSITION_EPSILON
    )
  })

const normalizePipeline9ViaMetadataFromLayerTransitions = (
  routes: HighDensityRoute[],
): HighDensityRoute[] =>
  materializeRoutes(routes).map((route) => {
    const seenViaLocations = new Set<string>()
    const vias = route.route.flatMap((point, pointIndex) => {
      const nextPoint = route.route[pointIndex + 1]
      if (
        !nextPoint ||
        point.z === nextPoint.z ||
        point.x !== nextPoint.x ||
        point.y !== nextPoint.y
      ) {
        return []
      }

      const locationKey = `${point.x}:${point.y}`
      if (seenViaLocations.has(locationKey)) return []
      seenViaLocations.add(locationKey)
      return [{ x: point.x, y: point.y }]
    })

    return { ...route, vias }
  })

const getPointToSegmentDistance = (
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number => {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const lengthSquared = deltaX * deltaX + deltaY * deltaY
  if (lengthSquared <= POSITION_EPSILON) {
    return getPointDistance(point, start)
  }
  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) /
        lengthSquared,
    ),
  )
  return getPointDistance(point, {
    x: start.x + deltaX * projection,
    y: start.y + deltaY * projection,
  })
}

const getCoincidentTerminalPointIndexes = (
  route: HighDensityRoute,
  endpointIndex: number,
): number[] => {
  const endpoint = route.route[endpointIndex]
  if (!endpoint) return []
  const indexes = [endpointIndex]
  const direction = endpointIndex === 0 ? 1 : -1

  for (
    let pointIndex = endpointIndex + direction;
    pointIndex >= 0 && pointIndex < route.route.length;
    pointIndex += direction
  ) {
    const point = route.route[pointIndex]
    if (!point || getPointDistance(point, endpoint) > POSITION_EPSILON) break
    indexes.push(pointIndex)
  }

  return indexes
}

export class Pipeline9ExactDrcRepairSolver extends GlobalDrcBranchPortfolioSolver {
  private readonly originalObstacles: Obstacle[]
  private readonly initialHdRoutes: HighDensityRoute[]
  private readonly terminalConstraints: TerminalConstraint[]
  private readonly b01Rerouter: Pipeline9B01Rerouter
  private cleanupStarted = false
  private cleanupCandidateAttempts = 0
  private cleanupCandidatesAccepted = 0
  private localCleanupDrcEvaluations = 0
  private selectedLocalCleanupDrcEvaluationLimit =
    DEFAULT_MAX_LOCAL_CLEANUP_DRC_EVALUATIONS
  private consecutiveLocalCleanupDrcMisses = 0
  private maxConsecutiveLocalCleanupDrcMisses = 0
  private selectedConsecutiveLocalCleanupDrcMissLimit =
    DEFAULT_MAX_CONSECUTIVE_LOCAL_CLEANUP_DRC_MISSES
  private selectedB01IterationLimit = DEFAULT_MAX_B01_TOTAL_ITERATIONS
  private viaMicroShiftAttempts = 0
  private viaMicroShiftsAccepted = 0
  private b01FullAttempts = 0
  private b01InteriorAttempts = 0
  private b01FixedOnlyAttempts = 0
  private b01CandidatesAccepted = 0
  private b01Iterations = 0
  private errorOwnedClusterOrderAttempts = 0
  private errorOwnedClusterRouteAttempts = 0
  private errorOwnedClusterDrcEvaluations = 0
  private errorOwnedClusterIterations = 0
  private errorOwnedClusterAccepted = 0
  private errorOwnedClusterTerminalEscapeAttempts = 0
  private errorOwnedClusterPostRouteAttempts = 0
  private errorOwnedClusterPostCandidatesAccepted = 0
  private postClusterViaMicroShiftDrcEvaluations = 0
  private finalOwnerFullAttempts = 0
  private finalOwnerInteriorAttempts = 0
  private finalOwnerDrcEvaluations = 0
  private finalOwnerCandidatesAccepted = 0
  private finalOwnerIterations = 0
  private finalOwnerIterationLimit = MAX_FINAL_OWNER_B01_ITERATIONS
  private postRepairSameNetViaMergeAttempts = 0
  private postRepairSameNetViaMergeDrcEvaluations = 0
  private postRepairSameNetViaMergeCandidatesAccepted = 0
  private postRepairSameNetViaMergeIterations = 0
  private sharedTerminalCompositeAttempts = 0
  private sharedTerminalCompositeRelocatedBranches = 0
  private sharedTerminalCompositeB01Attempts = 0
  private sharedTerminalCompositeDrcEvaluations = 0
  private sharedTerminalCompositeCandidatesAccepted = 0
  private sharedTerminalCompositeIterations = 0
  private postFinalCompositeAttempts = 0
  private postFinalCompositeForwardAttempts = 0
  private postFinalCompositeReverseAttempts = 0
  private postFinalCompositeTerminalRootedAttempts = 0
  private postFinalCompositeDrcEvaluations = 0
  private postFinalCompositeCandidatesAccepted = 0
  private postFinalCompositeIterations = 0
  private postFinalCompositeSameNetViaMergeIterations = 0
  private anchoredFixedCopperAttempts = 0
  private anchoredFixedCopperDrcEvaluations = 0
  private anchoredFixedCopperCandidatesAccepted = 0
  private anchoredFixedCopperIterations = 0
  private fixedCopperCompositePrimaryAttempts = 0
  private fixedCopperCompositeFollowupAttempts = 0
  private fixedCopperCompositeDrcEvaluations = 0
  private fixedCopperCompositeCandidatesAccepted = 0
  private fixedCopperCompositeIterations = 0
  private finalEndpointSlideAttempts = 0
  private finalEndpointSlideDrcEvaluations = 0
  private finalEndpointSlideCandidatesAccepted = 0
  private finalEndpointSlideRelocatedBranches = 0
  private finalContinuityTerminalViaAttempts = 0
  private finalContinuityTerminalViaDrcEvaluations = 0
  private finalContinuityTerminalViaCandidatesAccepted = 0
  private finalFixedOverlapLayerDetourDrcEvaluations = 0
  private finalFixedOverlapLayerDetourCandidatesAccepted = 0
  private finalFixedOverlapBestRemovedTargetIssueCount =
    Number.POSITIVE_INFINITY
  private finalFixedOverlapBestRemovedTargetFixedScore =
    Number.POSITIVE_INFINITY

  constructor(params: Pipeline9ExactDrcRepairSolverParams) {
    const normalizedParams = {
      ...params,
      hdRoutes: normalizePipeline9ViaMetadataFromLayerTransitions(
        params.hdRoutes,
      ),
    }
    super(normalizedParams)
    this.initialHdRoutes = cloneRoutes(normalizedParams.hdRoutes)
    this.originalObstacles = params.originalObstacles
    this.b01Rerouter = new Pipeline9B01Rerouter({
      srj: params.srj,
      baseObstacles: params.b01BaseObstacles,
      connMap: params.connMap,
    })
    this.terminalConstraints = normalizedParams.hdRoutes.flatMap(
      (route, routeIndex) =>
        (["start", "end"] as const).flatMap((endpoint) => {
          const point =
            endpoint === "start" ? route.route[0] : route.route.at(-1)
          if (!point) return []
          const traceRadius =
            (route.traceThickness ?? params.srj.minTraceWidth) / 2
          const owningObstacles = params.originalObstacles.filter(
            (obstacle) =>
              obstacleSharesRouteNet(obstacle, route) &&
              obstacleAppliesToLayer(
                obstacle,
                point.z,
                params.srj.layerCount,
              ) &&
              pointFitsInsideObstacle(point, obstacle, 0),
          )
          return [
            {
              routeIndex,
              endpoint,
              originalPoint: { ...point },
              traceRadius,
              owningObstacles,
            },
          ]
        }),
    )
  }

  private getSnapshot(routes: HighDensityRoute[]) {
    return getDrcSnapshot(
      this.params.srj,
      routes,
      this.params.drcEvaluator,
      this.params.connMap,
    )
  }

  private isFixedCopperIssue(error: DrcError, snapshot: DrcSnapshot): boolean {
    const errorType = getErrorType(error)
    const primaryTraceId =
      typeof error.pcb_trace_id === "string" ? error.pcb_trace_id : undefined
    const otherTraceId = getRawOtherTraceId(error)
    const primaryIsCandidate = Boolean(
      primaryTraceId && snapshot.traceRouteIndexById.has(primaryTraceId),
    )
    if (
      errorType === "pcb_via_trace_clearance_error" &&
      primaryTraceId &&
      !primaryIsCandidate
    ) {
      return true
    }
    if (errorType !== "pcb_trace_error" || !primaryTraceId || !otherTraceId) {
      return false
    }
    const otherIsCandidate = snapshot.traceRouteIndexById.has(otherTraceId)
    return primaryIsCandidate !== otherIsCandidate
  }

  private getFixedCopperIssueCount(snapshot: DrcSnapshot): number {
    return snapshot.errors.filter((error) =>
      this.isFixedCopperIssue(error, snapshot),
    ).length
  }

  private getFixedCopperIssueScore(snapshot: DrcSnapshot): number {
    return snapshot.errors.reduce((score, error) => {
      if (!this.isFixedCopperIssue(error, snapshot)) return score
      return score + (getErrorType(error) === "pcb_trace_error" ? 2 : 1)
    }, 0)
  }

  private getFixedCopperTraceOverlapCount(snapshot: DrcSnapshot): number {
    return snapshot.errors.filter(
      (error) =>
        getErrorType(error) === "pcb_trace_error" &&
        this.isFixedCopperIssue(error, snapshot),
    ).length
  }

  private snapshotImprovesWithoutFixedCopperRegression(
    candidate: DrcSnapshot,
    baseline: DrcSnapshot,
  ): boolean {
    return (
      candidate.count < baseline.count &&
      this.getFixedCopperTraceOverlapCount(candidate) <=
        this.getFixedCopperTraceOverlapCount(baseline) &&
      this.getFixedCopperIssueScore(candidate) <=
        this.getFixedCopperIssueScore(baseline)
    )
  }

  private unlockCleanupTerminals(
    routes: HighDensityRoute[],
  ): HighDensityRoute[] {
    return routes.map((route) => ({
      ...route,
      route: route.route.map((point, pointIndex) => {
        if (pointIndex !== 0 && pointIndex !== route.route.length - 1) {
          return point
        }
        const { pcb_port_id: _pcbPortId, ...movablePoint } = point
        return movablePoint
      }),
    }))
  }

  private restoreTerminalIds(routes: HighDensityRoute[]): HighDensityRoute[] {
    const markerByRouteAndEndpoint = new Map(
      this.terminalConstraints
        .filter(
          (
            constraint,
          ): constraint is TerminalConstraint & {
            originalPoint: HighDensityRoute["route"][number] & {
              pcb_port_id: string
            }
          } => typeof constraint.originalPoint.pcb_port_id === "string",
        )
        .map((constraint) => [
          `${constraint.routeIndex}:${constraint.endpoint}`,
          constraint.originalPoint.pcb_port_id,
        ]),
    )

    return routes.map((route, routeIndex) => ({
      ...route,
      route: route.route.map((point, pointIndex) => {
        const endpoint =
          pointIndex === 0
            ? "start"
            : pointIndex === route.route.length - 1
              ? "end"
              : undefined
        if (!endpoint) return point
        const pcbPortId = markerByRouteAndEndpoint.get(
          `${routeIndex}:${endpoint}`,
        )
        return pcbPortId ? { ...point, pcb_port_id: pcbPortId } : point
      }),
    }))
  }

  private candidatePreservesTerminals(routes: HighDensityRoute[]): boolean {
    return this.terminalConstraints.every((constraint) => {
      const route = routes[constraint.routeIndex]
      const point =
        constraint.endpoint === "start" ? route?.route[0] : route?.route.at(-1)
      if (!point || point.z !== constraint.originalPoint.z) return false

      const stayedAtOriginalPosition =
        getPointDistance(point, constraint.originalPoint) <= POSITION_EPSILON
      if (stayedAtOriginalPosition) return true

      return constraint.owningObstacles.some((obstacle) =>
        pointFitsInsideObstacle(point, obstacle, constraint.traceRadius),
      )
    })
  }

  private candidateImprovesSnapshot(
    candidateRoutes: HighDensityRoute[],
    currentSnapshot: DrcSnapshot,
    source: "local" | "b01" = "local",
  ): boolean {
    this.cleanupCandidateAttempts += 1
    if (!this.candidatePreservesTerminals(candidateRoutes)) return false
    if (
      source === "local" &&
      this.localCleanupDrcEvaluations >=
        this.selectedLocalCleanupDrcEvaluationLimit
    ) {
      return false
    }
    if (source === "local") this.localCleanupDrcEvaluations += 1

    const candidateSnapshot = this.getSnapshot(candidateRoutes)
    if (
      !this.snapshotImprovesWithoutFixedCopperRegression(
        candidateSnapshot,
        currentSnapshot,
      )
    ) {
      if (source === "local") {
        this.consecutiveLocalCleanupDrcMisses += 1
        this.maxConsecutiveLocalCleanupDrcMisses = Math.max(
          this.maxConsecutiveLocalCleanupDrcMisses,
          this.consecutiveLocalCleanupDrcMisses,
        )
      }
      return false
    }
    if (source === "local") this.consecutiveLocalCleanupDrcMisses = 0
    this.cleanupCandidatesAccepted += 1
    return true
  }

  private hasLocalCleanupBudget(): boolean {
    return (
      this.localCleanupDrcEvaluations <
        this.selectedLocalCleanupDrcEvaluationLimit &&
      this.consecutiveLocalCleanupDrcMisses <
        this.selectedConsecutiveLocalCleanupDrcMissLimit
    )
  }

  private selectAdaptiveCleanupLimits(): void {
    const initialDrcIssueCount = this.stats.initialDrcIssueCount
    const useHighInitialDrcLimits =
      typeof initialDrcIssueCount === "number" &&
      initialDrcIssueCount >= HIGH_INITIAL_DRC_THRESHOLD
    this.selectedLocalCleanupDrcEvaluationLimit = useHighInitialDrcLimits
      ? HIGH_INITIAL_DRC_MAX_LOCAL_CLEANUP_DRC_EVALUATIONS
      : DEFAULT_MAX_LOCAL_CLEANUP_DRC_EVALUATIONS
    this.selectedConsecutiveLocalCleanupDrcMissLimit = useHighInitialDrcLimits
      ? HIGH_INITIAL_DRC_MAX_CONSECUTIVE_LOCAL_CLEANUP_DRC_MISSES
      : DEFAULT_MAX_CONSECUTIVE_LOCAL_CLEANUP_DRC_MISSES
    this.selectedB01IterationLimit = useHighInitialDrcLimits
      ? HIGH_INITIAL_DRC_MAX_B01_TOTAL_ITERATIONS
      : DEFAULT_MAX_B01_TOTAL_ITERATIONS
  }

  private getCandidateRouteIndexesForError(
    error: DrcError,
    snapshot: DrcSnapshot,
  ): number[] {
    const primaryTraceId =
      typeof error.pcb_trace_id === "string" ? error.pcb_trace_id : undefined
    const otherTraceId = getOtherTraceId(error, snapshot.traceRouteIndexById)
    const routeIndexes: number[] = []
    const seenRouteIndexes = new Set<number>()

    for (const traceId of [
      ...getCandidateTraceIdsFromError(error),
      otherTraceId,
      primaryTraceId,
    ]) {
      if (!traceId) continue
      const routeIndex = snapshot.traceRouteIndexById.get(traceId)
      if (routeIndex === undefined || seenRouteIndexes.has(routeIndex)) {
        continue
      }
      seenRouteIndexes.add(routeIndex)
      routeIndexes.push(routeIndex)
    }

    return routeIndexes
  }

  private getViaTransitionGroups(
    route: HighDensityRoute,
    routeIndex: number,
    errorCenter: { x: number; y: number },
  ): ViaTransitionGroup[] {
    const groups: ViaTransitionGroup[] = []
    const seenGroups = new Set<string>()

    for (
      let pointIndex = 0;
      pointIndex < route.route.length - 1;
      pointIndex += 1
    ) {
      const point = route.route[pointIndex]
      const nextPoint = route.route[pointIndex + 1]
      if (
        !point ||
        !nextPoint ||
        point.z === nextPoint.z ||
        getPointDistance(point, nextPoint) > POSITION_EPSILON
      ) {
        continue
      }

      let startIndex = pointIndex
      let endIndex = pointIndex + 1
      while (
        startIndex > 0 &&
        getPointDistance(route.route[startIndex - 1]!, point) <=
          POSITION_EPSILON
      ) {
        startIndex -= 1
      }
      while (
        endIndex < route.route.length - 1 &&
        getPointDistance(route.route[endIndex + 1]!, point) <= POSITION_EPSILON
      ) {
        endIndex += 1
      }

      const groupKey = `${startIndex}:${endIndex}`
      if (seenGroups.has(groupKey)) continue
      seenGroups.add(groupKey)
      groups.push({
        routeIndex,
        indexes: Array.from(
          { length: endIndex - startIndex + 1 },
          (_, indexOffset) => startIndex + indexOffset,
        ),
        x: point.x,
        y: point.y,
        distanceToError: getPointDistance(point, errorCenter),
      })
    }

    return groups
      .toSorted((left, right) => left.distanceToError - right.distanceToError)
      .slice(0, MAX_VIA_GROUPS_PER_ROUTE)
  }

  private tryViaMicroShift(
    routes: HighDensityRoute[],
    error: DrcError,
    sweepBudget = {
      remaining: MAX_VIA_MICRO_SHIFT_DRC_EVALUATIONS_PER_SWEEP,
    },
  ): HighDensityRoute[] | undefined {
    if (!this.hasLocalCleanupBudget() || sweepBudget.remaining <= 0) {
      return undefined
    }
    const errorType = getErrorType(error)
    if (
      errorType !== "pcb_via_clearance_error" &&
      errorType !== "pcb_via_trace_clearance_error"
    ) {
      return undefined
    }
    const errorCenter = this.getErrorCenter(error)
    if (!errorCenter) return undefined

    const snapshot = this.getSnapshot(routes)
    const preloadedTraceId =
      errorType === "pcb_via_trace_clearance_error"
        ? this.b01Rerouter.getPreloadedTraceIdForDrcTraceId(
            typeof error.pcb_trace_id === "string"
              ? error.pcb_trace_id
              : getRawOtherTraceId(error),
          )
        : undefined
    const viaGroups: ViaTransitionGroup[] = []
    const seenViaGroups = new Set<string>()
    for (const routeIndex of this.getCandidateRouteIndexesForError(
      error,
      snapshot,
    )) {
      const route = routes[routeIndex]
      if (!route) continue
      const overlappingViaCenters = preloadedTraceId
        ? this.b01Rerouter.getRouteViaCentersOverlappingPreloadedTrace(
            route,
            preloadedTraceId,
          )
        : []
      const referenceCenters =
        overlappingViaCenters.length > 0 ? overlappingViaCenters : [errorCenter]
      for (const referenceCenter of referenceCenters) {
        for (const viaGroup of this.getViaTransitionGroups(
          route,
          routeIndex,
          referenceCenter,
        )) {
          const key = `${viaGroup.routeIndex}:${viaGroup.indexes.join(",")}`
          if (seenViaGroups.has(key)) continue
          seenViaGroups.add(key)
          viaGroups.push(viaGroup)
        }
      }
    }
    if (viaGroups.length === 0) return undefined

    for (const viaGroup of viaGroups) {
      const route = routes[viaGroup.routeIndex]
      if (!route) continue
      const nearestOtherVia = viaGroups
        .filter(
          (candidate) =>
            candidate !== viaGroup &&
            getPointDistance(candidate, viaGroup) > POSITION_EPSILON,
        )
        .toSorted(
          (left, right) =>
            getPointDistance(left, viaGroup) -
            getPointDistance(right, viaGroup),
        )[0]
      const preferredDirection = nearestOtherVia
        ? getUnitDirection(
            viaGroup.x - nearestOtherVia.x,
            viaGroup.y - nearestOtherVia.y,
          )
        : getUnitDirection(
            viaGroup.x - errorCenter.x,
            viaGroup.y - errorCenter.y,
          )

      for (const direction of getMicroShiftDirections(preferredDirection)) {
        for (const radius of VIA_MICRO_SHIFT_RADII) {
          if (!this.hasLocalCleanupBudget() || sweepBudget.remaining <= 0) {
            return undefined
          }
          const candidateX = viaGroup.x + direction.x * radius
          const candidateY = viaGroup.y + direction.y * radius
          const viaInset = route.viaDiameter / 2
          if (
            candidateX <
              this.params.srj.bounds.minX + viaInset - POSITION_EPSILON ||
            candidateX >
              this.params.srj.bounds.maxX - viaInset + POSITION_EPSILON ||
            candidateY <
              this.params.srj.bounds.minY + viaInset - POSITION_EPSILON ||
            candidateY >
              this.params.srj.bounds.maxY - viaInset + POSITION_EPSILON
          ) {
            continue
          }

          const candidateRoutes = cloneRoutes(routes)
          const candidateRoute = candidateRoutes[viaGroup.routeIndex]
          if (!candidateRoute) continue
          for (const pointIndex of viaGroup.indexes) {
            const point = candidateRoute.route[pointIndex]
            if (!point) continue
            point.x = candidateX
            point.y = candidateY
          }
          if (!routeHasValidLayerTransitions(candidateRoute)) continue

          this.viaMicroShiftAttempts += 1
          sweepBudget.remaining -= 1
          const materializedCandidate = materializeRoutes(candidateRoutes)
          if (this.candidateImprovesSnapshot(materializedCandidate, snapshot)) {
            this.viaMicroShiftsAccepted += 1
            return materializedCandidate
          }
        }
      }
    }

    return undefined
  }

  private runViaMicroShiftCleanup(
    routes: HighDensityRoute[],
  ): HighDensityRoute[] {
    let improvedRoutes = routes
    const sweepBudget = {
      remaining: MAX_VIA_MICRO_SHIFT_DRC_EVALUATIONS_PER_SWEEP,
    }

    while (this.hasLocalCleanupBudget() && sweepBudget.remaining > 0) {
      const snapshot = this.getSnapshot(improvedRoutes)
      if (snapshot.count === 0) break
      if (snapshot.count > MAX_VIA_MICRO_SHIFT_SNAPSHOT_ISSUES) break
      let nextRoutes: HighDensityRoute[] | undefined
      for (const error of snapshot.errors) {
        nextRoutes = this.tryViaMicroShift(improvedRoutes, error, sweepBudget)
        if (
          nextRoutes ||
          !this.hasLocalCleanupBudget() ||
          sweepBudget.remaining <= 0
        ) {
          break
        }
      }
      if (!nextRoutes) break
      improvedRoutes = nextRoutes
    }

    return improvedRoutes
  }

  private tryEndpointSlide(
    routes: HighDensityRoute[],
    error: DrcError,
  ): HighDensityRoute[] | undefined {
    if (!this.hasLocalCleanupBudget()) return undefined
    const errorType = getErrorType(error)
    const padId = getPhysicalPadIdFromError(error)
    if (
      !padId ||
      (errorType !== "pcb_pad_trace_clearance_error" &&
        errorType !== "pcb_trace_error")
    ) {
      return undefined
    }

    const snapshot = this.getSnapshot(routes)
    const traceId = error.pcb_trace_id
    if (typeof traceId !== "string") return undefined
    const routeIndex = snapshot.traceRouteIndexById.get(traceId)
    if (routeIndex === undefined) return undefined
    const route = routes[routeIndex]
    const foreignObstacle = this.originalObstacles.find((obstacle) =>
      obstacleRepresentsPhysicalPad(obstacle, padId),
    )
    if (!route || !foreignObstacle || route.route.length < 2) {
      return undefined
    }

    const endpointIndexes = [0, route.route.length - 1].sort((left, right) => {
      const leftPoint = route.route[left]!
      const rightPoint = route.route[right]!
      return (
        getPointDistance(leftPoint, foreignObstacle.center) -
        getPointDistance(rightPoint, foreignObstacle.center)
      )
    })

    for (const endpointIndex of endpointIndexes) {
      const endpoint = route.route[endpointIndex]!
      const traceRadius =
        (endpoint.traceThickness ??
          route.traceThickness ??
          this.params.srj.minTraceWidth) / 2
      const ownObstacles = this.originalObstacles.filter(
        (obstacle) =>
          obstacle !== foreignObstacle &&
          obstacleSharesRouteNet(obstacle, route) &&
          obstacleAppliesToLayer(
            obstacle,
            endpoint.z,
            this.params.srj.layerCount,
          ) &&
          pointFitsInsideObstacle(endpoint, obstacle, 0),
      )
      if (ownObstacles.length === 0) continue

      const awayX = endpoint.x - foreignObstacle.center.x
      const awayY = endpoint.y - foreignObstacle.center.y
      const awayLength = Math.hypot(awayX, awayY)
      const normalizedAway =
        awayLength > POSITION_EPSILON
          ? { x: awayX / awayLength, y: awayY / awayLength }
          : { x: 1, y: 0 }
      const directions = [
        normalizedAway,
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
        { x: Math.SQRT1_2, y: Math.SQRT1_2 },
        { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
        { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
        { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
      ]
      const coincidentIndexes = getCoincidentTerminalPointIndexes(
        route,
        endpointIndex,
      )

      for (const radius of ENDPOINT_SLIDE_RADII) {
        for (const direction of directions) {
          if (!this.hasLocalCleanupBudget()) return undefined
          const candidatePoint = {
            x: endpoint.x + direction.x * radius,
            y: endpoint.y + direction.y * radius,
          }
          if (
            !ownObstacles.some((obstacle) =>
              pointFitsInsideObstacle(candidatePoint, obstacle, traceRadius),
            )
          ) {
            continue
          }

          const candidateRoutes = cloneRoutes(routes)
          const candidateRoute = candidateRoutes[routeIndex]
          if (!candidateRoute) continue
          for (const pointIndex of coincidentIndexes) {
            const point = candidateRoute.route[pointIndex]
            if (!point) continue
            point.x = candidatePoint.x
            point.y = candidatePoint.y
          }
          const materializedCandidate = materializeRoutes(candidateRoutes)
          if (this.candidateImprovesSnapshot(materializedCandidate, snapshot)) {
            return materializedCandidate
          }
        }
      }
    }

    return undefined
  }

  private tryLocalTraceLayerDetour(
    routes: HighDensityRoute[],
    error: DrcError,
    options: {
      preferFixedCopperIssueReduction?: boolean
      maxIssueCountIncrease?: number
    } = {},
  ): HighDensityRoute[] | undefined {
    if (!this.hasLocalCleanupBudget()) return undefined
    const errorType = getErrorType(error)
    if (
      errorType !== "pcb_trace_error" &&
      errorType !== "pcb_pad_trace_clearance_error"
    ) {
      return undefined
    }
    const center = error.center
    if (
      !center ||
      typeof center !== "object" ||
      typeof (center as { x?: unknown }).x !== "number" ||
      typeof (center as { y?: unknown }).y !== "number"
    ) {
      return undefined
    }

    const snapshot = this.getSnapshot(routes)
    const primaryTraceId = error.pcb_trace_id
    const otherTraceId = getOtherTraceId(error, snapshot.traceRouteIndexById)
    const traceIds = [otherTraceId, primaryTraceId].filter(
      (traceId): traceId is string =>
        typeof traceId === "string" &&
        snapshot.traceRouteIndexById.has(traceId),
    )
    const errorCenter = center as { x: number; y: number }
    const baselineFixedCopperIssueScore =
      this.getFixedCopperIssueScore(snapshot)
    const targetErrorIdentity = this.getDrcErrorIdentity(error)
    let bestFixedCopperCandidate:
      | {
          routes: HighDensityRoute[]
          snapshot: DrcSnapshot
        }
      | undefined

    for (const traceId of traceIds) {
      const routeIndex = snapshot.traceRouteIndexById.get(traceId)!
      const route = routes[routeIndex]
      if (!route || route.route.length < 2) continue

      let nearestSegmentIndex = -1
      let nearestSegmentDistance = Number.POSITIVE_INFINITY
      for (
        let segmentIndex = 0;
        segmentIndex < route.route.length - 1;
        segmentIndex += 1
      ) {
        const start = route.route[segmentIndex]
        const end = route.route[segmentIndex + 1]
        if (!start || !end || start.z !== end.z) continue
        const segmentDistance = getPointToSegmentDistance(
          errorCenter,
          start,
          end,
        )
        if (segmentDistance < nearestSegmentDistance) {
          nearestSegmentDistance = segmentDistance
          nearestSegmentIndex = segmentIndex
        }
      }
      if (nearestSegmentIndex < 0) continue

      const z = route.route[nearestSegmentIndex]!.z
      let sameLayerStart = nearestSegmentIndex
      let sameLayerEnd = nearestSegmentIndex + 1
      while (sameLayerStart > 0 && route.route[sameLayerStart - 1]?.z === z) {
        sameLayerStart -= 1
      }
      while (
        sameLayerEnd < route.route.length - 1 &&
        route.route[sameLayerEnd + 1]?.z === z
      ) {
        sameLayerEnd += 1
      }

      const fullRunExpansion = Math.max(
        nearestSegmentIndex - sameLayerStart,
        sameLayerEnd - nearestSegmentIndex - 1,
      )
      const expansionCandidates = [
        ...Array.from(
          { length: MAX_LOCAL_LAYER_DETOUR_EXPANSION + 1 },
          (_, expansion) => expansion,
        ),
        ...(fullRunExpansion > MAX_LOCAL_LAYER_DETOUR_EXPANSION
          ? [fullRunExpansion]
          : []),
      ]

      for (const expansion of expansionCandidates) {
        const detourStart = Math.max(
          sameLayerStart,
          nearestSegmentIndex - expansion,
        )
        const detourEnd = Math.min(
          sameLayerEnd,
          nearestSegmentIndex + 1 + expansion,
        )
        if (detourEnd <= detourStart) continue

        for (
          let targetZ = 0;
          targetZ < this.params.srj.layerCount;
          targetZ += 1
        ) {
          if (!this.hasLocalCleanupBudget()) return undefined
          if (targetZ === z) continue
          const candidateRoutes = cloneRoutes(routes)
          const candidateRoute = candidateRoutes[routeIndex]
          if (!candidateRoute) continue
          const startPoint = candidateRoute.route[detourStart]
          if (!startPoint || !candidateRoute.route[detourEnd]) continue

          const detourPoints = candidateRoute.route
            .slice(detourStart, detourEnd + 1)
            .map((point) => ({
              ...point,
              z: targetZ,
              pcb_port_id: undefined,
            }))
          candidateRoute.route.splice(
            detourStart + 1,
            detourEnd - detourStart - 1,
            ...detourPoints,
          )

          const materializedCandidate = materializeRoutes(candidateRoutes)
          if (options.preferFixedCopperIssueReduction) {
            this.cleanupCandidateAttempts += 1
            if (!this.candidatePreservesTerminals(materializedCandidate)) {
              continue
            }
            if (!this.hasLocalCleanupBudget()) {
              return bestFixedCopperCandidate?.routes
            }
            this.localCleanupDrcEvaluations += 1
            const candidateSnapshot = this.getSnapshot(materializedCandidate)
            const candidateFixedCopperIssueScore =
              this.getFixedCopperIssueScore(candidateSnapshot)
            const targetErrorWasRemoved = !candidateSnapshot.errors.some(
              (candidateError) =>
                this.getDrcErrorIdentity(candidateError) ===
                targetErrorIdentity,
            )
            if (targetErrorWasRemoved) {
              this.finalFixedOverlapBestRemovedTargetIssueCount = Math.min(
                this.finalFixedOverlapBestRemovedTargetIssueCount,
                candidateSnapshot.count,
              )
              this.finalFixedOverlapBestRemovedTargetFixedScore = Math.min(
                this.finalFixedOverlapBestRemovedTargetFixedScore,
                candidateFixedCopperIssueScore,
              )
            }
            const isEligible =
              (candidateFixedCopperIssueScore < baselineFixedCopperIssueScore ||
                (candidateFixedCopperIssueScore ===
                  baselineFixedCopperIssueScore &&
                  targetErrorWasRemoved)) &&
              candidateSnapshot.count <=
                snapshot.count + (options.maxIssueCountIncrease ?? 2)
            const isBetter =
              isEligible &&
              (!bestFixedCopperCandidate ||
                candidateFixedCopperIssueScore <
                  this.getFixedCopperIssueScore(
                    bestFixedCopperCandidate.snapshot,
                  ) ||
                (candidateFixedCopperIssueScore ===
                  this.getFixedCopperIssueScore(
                    bestFixedCopperCandidate.snapshot,
                  ) &&
                  candidateSnapshot.count <
                    bestFixedCopperCandidate.snapshot.count))
            if (isBetter) {
              bestFixedCopperCandidate = {
                routes: materializedCandidate,
                snapshot: candidateSnapshot,
              }
            } else {
              this.consecutiveLocalCleanupDrcMisses += 1
              this.maxConsecutiveLocalCleanupDrcMisses = Math.max(
                this.maxConsecutiveLocalCleanupDrcMisses,
                this.consecutiveLocalCleanupDrcMisses,
              )
            }
            continue
          }
          if (this.candidateImprovesSnapshot(materializedCandidate, snapshot)) {
            return materializedCandidate
          }
        }
      }
    }

    if (bestFixedCopperCandidate) {
      this.cleanupCandidatesAccepted += 1
      this.consecutiveLocalCleanupDrcMisses = 0
      return bestFixedCopperCandidate.routes
    }
    return undefined
  }

  private tryBatchedTraceForce(
    routes: HighDensityRoute[],
    error: DrcError,
  ): HighDensityRoute[] | undefined {
    if (!this.hasLocalCleanupBudget()) return undefined
    const errorType = getErrorType(error)
    if (
      errorType !== "pcb_trace_error" &&
      errorType !== "pcb_pad_trace_clearance_error"
    ) {
      return undefined
    }

    const snapshot = this.getSnapshot(routes)
    const primaryTraceId = error.pcb_trace_id
    const otherTraceId = getOtherTraceId(error, snapshot.traceRouteIndexById)
    const traceIds = [otherTraceId, primaryTraceId].filter(
      (traceId): traceId is string =>
        typeof traceId === "string" &&
        snapshot.traceRouteIndexById.has(traceId),
    )
    for (const traceId of traceIds) {
      for (const scale of BATCHED_TRACE_FORCE_SCALES) {
        let candidateRoutes = cloneRoutes(routes)
        for (let pass = 0; pass < MAX_BATCHED_TRACE_FORCE_PASSES; pass += 1) {
          if (!this.hasLocalCleanupBudget()) return undefined
          const changed = applyDrcErrorForces(
            this.params.srj,
            candidateRoutes,
            [{ ...error, pcb_trace_id: traceId }],
            snapshot.traceRouteIndexById,
            scale,
            this.params.connMap,
          )
          if (!changed) break

          const materializedCandidate = materializeRoutes(candidateRoutes)
          if (this.candidateImprovesSnapshot(materializedCandidate, snapshot)) {
            return materializedCandidate
          }
          candidateRoutes = cloneRoutes(materializedCandidate)
        }
      }
    }

    return undefined
  }

  private getRemainingB01Iterations(): number {
    return Math.max(0, this.selectedB01IterationLimit - this.b01Iterations)
  }

  private tryB01Candidate(
    routes: HighDensityRoute[],
    snapshot: DrcSnapshot,
    options: Omit<Pipeline9B01RerouteOptions, "maxIterations">,
    maxIterations: number,
  ): HighDensityRoute[] | undefined {
    const iterationLimit = Math.min(
      maxIterations,
      this.getRemainingB01Iterations(),
    )
    if (iterationLimit <= 0) return undefined

    const result = this.b01Rerouter.tryReroute(routes, {
      ...options,
      maxIterations: iterationLimit,
    })
    this.b01Iterations += Math.max(0, result?.iterations ?? 0)
    if (!result?.route) return undefined

    const candidateRoutes = cloneRoutes(routes)
    candidateRoutes[options.routeIndex] = result.route
    const materializedCandidate = materializeRoutes(candidateRoutes)
    if (
      !this.candidateImprovesSnapshot(materializedCandidate, snapshot, "b01")
    ) {
      return undefined
    }

    this.b01CandidatesAccepted += 1
    return materializedCandidate
  }

  private getOrderedB01RouteIndexes(snapshot: DrcSnapshot): number[] {
    const orderedRouteIndexes: number[] = []
    const seenRouteIndexes = new Set<number>()
    const seenErrorGroups = new Set<string>()

    for (const [errorIndex, error] of snapshot.errors.entries()) {
      const primaryTraceId = error.pcb_trace_id
      const errorGroup =
        typeof primaryTraceId === "string"
          ? `trace:${primaryTraceId}`
          : `error:${errorIndex}`
      if (seenErrorGroups.has(errorGroup)) continue
      seenErrorGroups.add(errorGroup)

      const relatedErrors =
        typeof primaryTraceId === "string"
          ? snapshot.errors.filter(
              (relatedError) => relatedError.pcb_trace_id === primaryTraceId,
            )
          : [error]
      for (const relatedError of relatedErrors) {
        const otherTraceId = getOtherTraceId(
          relatedError,
          snapshot.traceRouteIndexById,
        )
        for (const traceId of [
          ...getCandidateTraceIdsFromError(relatedError),
          otherTraceId,
        ]) {
          if (!traceId || traceId === primaryTraceId) continue
          const routeIndex = snapshot.traceRouteIndexById.get(traceId)
          if (routeIndex !== undefined && !seenRouteIndexes.has(routeIndex)) {
            seenRouteIndexes.add(routeIndex)
            orderedRouteIndexes.push(routeIndex)
          }
        }
      }

      const primaryRouteIndex =
        typeof primaryTraceId === "string"
          ? snapshot.traceRouteIndexById.get(primaryTraceId)
          : undefined
      if (
        primaryRouteIndex !== undefined &&
        !seenRouteIndexes.has(primaryRouteIndex)
      ) {
        seenRouteIndexes.add(primaryRouteIndex)
        orderedRouteIndexes.push(primaryRouteIndex)
      }
    }

    return orderedRouteIndexes
  }

  private runB01FullRouteCleanup(
    routes: HighDensityRoute[],
  ): HighDensityRoute[] {
    let improvedRoutes = routes
    let roundAttempts = 0

    while (
      roundAttempts < MAX_B01_FULL_ATTEMPTS_PER_ROUND &&
      this.getRemainingB01Iterations() > 0
    ) {
      const snapshot = this.getSnapshot(improvedRoutes)
      if (snapshot.count === 0) break
      let nextRoutes: HighDensityRoute[] | undefined
      const routeIndexes = this.getOrderedB01RouteIndexes(snapshot)

      attemptLoop: for (const variant of FULL_B01_VARIANTS) {
        for (const routeIndex of routeIndexes) {
          if (
            roundAttempts >= MAX_B01_FULL_ATTEMPTS_PER_ROUND ||
            this.getRemainingB01Iterations() <= 0
          ) {
            break attemptLoop
          }
          roundAttempts += 1
          this.b01FullAttempts += 1
          nextRoutes = this.tryB01Candidate(
            improvedRoutes,
            snapshot,
            {
              routeIndex,
              includeCandidateCopper: true,
              ...variant,
            },
            MAX_B01_FULL_ITERATIONS,
          )
          if (nextRoutes) break attemptLoop
        }
      }

      if (!nextRoutes) break
      improvedRoutes = nextRoutes
    }

    return improvedRoutes
  }

  private getErrorCenter(
    error: DrcError,
  ): { x: number; y: number } | undefined {
    const center = error.center ?? error.pcb_center
    if (!center || typeof center !== "object") return undefined
    const maybeCenter = center as Record<string, unknown>
    if (
      typeof maybeCenter.x !== "number" ||
      typeof maybeCenter.y !== "number"
    ) {
      return undefined
    }
    return { x: maybeCenter.x, y: maybeCenter.y }
  }

  private getInteriorRerouteWindows(
    route: HighDensityRoute,
    center: { x: number; y: number },
  ): Array<{ startIndex: number; endIndex: number }> {
    if (route.route.length < 4) return []

    let nearestSegmentIndex = -1
    let nearestDistance = Number.POSITIVE_INFINITY
    for (
      let segmentIndex = 0;
      segmentIndex < route.route.length - 1;
      segmentIndex += 1
    ) {
      const start = route.route[segmentIndex]
      const end = route.route[segmentIndex + 1]
      if (!start || !end || start.z !== end.z) continue
      const distance = getPointToSegmentDistance(center, start, end)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestSegmentIndex = segmentIndex
      }
    }
    if (nearestSegmentIndex < 0) return []

    const lastRouteIndex = route.route.length - 1
    const lastInteriorIndex = route.route.length - 2

    const windows: Array<{ startIndex: number; endIndex: number }> = []
    const seenWindows = new Set<string>()
    const addRawWindow = (startIndex: number, endIndex: number) => {
      if (
        startIndex < 0 ||
        endIndex > lastRouteIndex ||
        startIndex >= endIndex
      ) {
        return
      }
      const key = `${startIndex}:${endIndex}`
      if (seenWindows.has(key)) return
      seenWindows.add(key)
      windows.push({ startIndex, endIndex })
    }
    const addWindowIfB01Sized = (startIndex: number, endIndex: number) => {
      const start = route.route[startIndex]
      const end = route.route[endIndex]
      if (
        !start ||
        !end ||
        Math.abs(start.x - end.x) > 15 + POSITION_EPSILON ||
        Math.abs(start.y - end.y) > 15 + POSITION_EPSILON
      ) {
        return
      }
      addRawWindow(startIndex, endIndex)
    }
    for (const expansion of [0, 1, 2, 4, 8, 12, 16, 24]) {
      addWindowIfB01Sized(
        Math.max(0, nearestSegmentIndex - expansion),
        lastRouteIndex,
      )
      addWindowIfB01Sized(
        0,
        Math.min(lastRouteIndex, nearestSegmentIndex + 1 + expansion),
      )
    }
    if (nearestSegmentIndex === 0) {
      for (const endIndex of [2, 4, 8]) {
        addRawWindow(0, Math.min(lastRouteIndex, endIndex))
      }
    }
    if (nearestSegmentIndex === lastRouteIndex - 1) {
      for (const startIndex of [
        lastRouteIndex - 2,
        lastRouteIndex - 4,
        lastRouteIndex - 8,
      ]) {
        addRawWindow(Math.max(0, startIndex), lastRouteIndex)
      }
    }
    if (
      nearestSegmentIndex < 1 ||
      nearestSegmentIndex + 1 > lastInteriorIndex
    ) {
      return windows
    }

    const addWindow = (startIndex: number, endIndex: number) => {
      const boundedStart = Math.max(1, startIndex)
      const boundedEnd = Math.min(lastInteriorIndex, endIndex)
      if (
        boundedStart > nearestSegmentIndex ||
        boundedEnd < nearestSegmentIndex + 1 ||
        boundedStart >= boundedEnd
      ) {
        return
      }
      addRawWindow(boundedStart, boundedEnd)
    }

    addWindow(
      nearestSegmentIndex - MAX_B01_INTERIOR_EXPANSION,
      nearestSegmentIndex + 1,
    )
    addWindow(
      nearestSegmentIndex,
      nearestSegmentIndex + 1 + MAX_B01_INTERIOR_EXPANSION,
    )
    addWindow(
      nearestSegmentIndex - MAX_B01_INTERIOR_EXPANSION,
      nearestSegmentIndex + 1 + MAX_B01_INTERIOR_EXPANSION,
    )

    for (
      let totalExpansion = 0;
      totalExpansion <= MAX_B01_INTERIOR_EXPANSION;
      totalExpansion += 1
    ) {
      for (
        let startExpansion = 0;
        startExpansion <= totalExpansion;
        startExpansion += 1
      ) {
        const endExpansion = totalExpansion - startExpansion
        addWindow(
          nearestSegmentIndex - startExpansion,
          nearestSegmentIndex + 1 + endExpansion,
        )
      }
    }

    return windows
  }

  private runB01InteriorCleanup(
    routes: HighDensityRoute[],
  ): HighDensityRoute[] {
    let improvedRoutes = routes
    let roundAttempts = 0

    while (
      roundAttempts < MAX_B01_INTERIOR_ATTEMPTS_PER_ROUND &&
      this.getRemainingB01Iterations() > 0
    ) {
      const snapshot = this.getSnapshot(improvedRoutes)
      if (snapshot.count === 0) break
      let nextRoutes: HighDensityRoute[] | undefined

      const targets: Array<{
        routeIndex: number
        windows: Array<{ startIndex: number; endIndex: number }>
      }> = []
      const seenTargets = new Set<string>()

      for (const error of snapshot.errors) {
        const center = this.getErrorCenter(error)
        if (!center) continue
        const primaryTraceId = error.pcb_trace_id
        const otherTraceId = getOtherTraceId(
          error,
          snapshot.traceRouteIndexById,
        )
        const traceIds = [
          ...getCandidateTraceIdsFromError(error),
          otherTraceId,
          primaryTraceId,
        ]
        const seenTraceIds = new Set<string>()

        for (const traceId of traceIds) {
          if (
            typeof traceId !== "string" ||
            seenTraceIds.has(traceId) ||
            !snapshot.traceRouteIndexById.has(traceId)
          ) {
            continue
          }
          seenTraceIds.add(traceId)
          const routeIndex = snapshot.traceRouteIndexById.get(traceId)!
          const route = improvedRoutes[routeIndex]
          if (!route) continue
          const windows = this.getInteriorRerouteWindows(route, center)
          if (windows.length === 0) continue
          const targetKey = `${routeIndex}:${windows
            .map(({ startIndex, endIndex }) => `${startIndex}-${endIndex}`)
            .join(",")}`
          if (seenTargets.has(targetKey)) continue
          seenTargets.add(targetKey)
          targets.push({ routeIndex, windows })
        }
      }

      const maximumWindowCount = Math.max(
        0,
        ...targets.map((target) => target.windows.length),
      )
      attemptLoop: for (
        let windowIndex = 0;
        windowIndex < maximumWindowCount;
        windowIndex += 1
      ) {
        for (const variant of INTERIOR_B01_VARIANTS) {
          for (const target of targets) {
            const window = target.windows[windowIndex]
            if (!window) continue
            if (
              roundAttempts >= MAX_B01_INTERIOR_ATTEMPTS_PER_ROUND ||
              this.getRemainingB01Iterations() <= 0
            ) {
              break attemptLoop
            }
            roundAttempts += 1
            this.b01InteriorAttempts += 1
            nextRoutes = this.tryB01Candidate(
              improvedRoutes,
              snapshot,
              {
                routeIndex: target.routeIndex,
                ...window,
                includeCandidateCopper: true,
                ...variant,
              },
              MAX_B01_INTERIOR_ITERATIONS,
            )
            if (nextRoutes) break attemptLoop
          }
        }
      }

      if (!nextRoutes) break
      improvedRoutes = nextRoutes
    }

    return improvedRoutes
  }

  private runB01FixedOnlyCleanup(
    routes: HighDensityRoute[],
  ): HighDensityRoute[] {
    let improvedRoutes = routes
    let roundAttempts = 0

    while (
      roundAttempts < MAX_B01_FIXED_ONLY_ATTEMPTS_PER_ROUND &&
      this.getRemainingB01Iterations() > 0
    ) {
      const snapshot = this.getSnapshot(improvedRoutes)
      if (snapshot.count === 0) break
      let nextRoutes: HighDensityRoute[] | undefined
      const routeIndexes = this.getOrderedB01RouteIndexes(snapshot)

      attemptLoop: for (const variant of FIXED_ONLY_B01_VARIANTS) {
        for (const routeIndex of routeIndexes) {
          if (
            roundAttempts >= MAX_B01_FIXED_ONLY_ATTEMPTS_PER_ROUND ||
            this.getRemainingB01Iterations() <= 0
          ) {
            break attemptLoop
          }
          roundAttempts += 1
          this.b01FixedOnlyAttempts += 1
          nextRoutes = this.tryB01Candidate(
            improvedRoutes,
            snapshot,
            {
              routeIndex,
              includeCandidateCopper: false,
              ...variant,
            },
            MAX_B01_FULL_ITERATIONS,
          )
          if (nextRoutes) break attemptLoop
        }
      }

      if (!nextRoutes) break
      improvedRoutes = nextRoutes
    }

    return improvedRoutes
  }

  private getErrorOwnedClusterRouteIndexes(
    error: DrcError,
    snapshot: DrcSnapshot,
    routes: HighDensityRoute[],
  ): number[] {
    const routeIndexes = new Set(
      this.getCandidateRouteIndexesForError(error, snapshot),
    )
    const referencedTraceIds = [
      typeof error.pcb_trace_id === "string" ? error.pcb_trace_id : undefined,
      getRawOtherTraceId(error),
    ].filter((traceId): traceId is string => Boolean(traceId))

    // A preloaded trace is namespaced as `preloaded_<n>_<trace id>`.
    // Include the candidate counterpart, when present, because rebuilding the
    // whole error-owned group can free the corridor used by its fixed copy.
    for (const referencedTraceId of referencedTraceIds) {
      let longestEmbeddedMatchLength = -1
      const embeddedRouteIndexes: number[] = []
      for (const [
        candidateTraceId,
        routeIndex,
      ] of snapshot.traceRouteIndexById) {
        if (
          referencedTraceId !== candidateTraceId &&
          !referencedTraceId.endsWith(`_${candidateTraceId}`)
        ) {
          continue
        }
        if (candidateTraceId.length > longestEmbeddedMatchLength) {
          longestEmbeddedMatchLength = candidateTraceId.length
          embeddedRouteIndexes.length = 0
        }
        if (candidateTraceId.length === longestEmbeddedMatchLength) {
          embeddedRouteIndexes.push(routeIndex)
        }
      }
      for (const routeIndex of embeddedRouteIndexes) {
        routeIndexes.add(routeIndex)
      }
    }

    return [...routeIndexes].filter(
      (routeIndex) => (routes[routeIndex]?.route.length ?? 0) >= 2,
    )
  }

  private getErrorOwnedClusterOrders(
    snapshot: DrcSnapshot,
    routes: HighDensityRoute[],
  ): number[][] {
    const residualDegreeByRouteIndex = new Map<number, number>()
    for (const error of snapshot.errors) {
      for (const routeIndex of this.getErrorOwnedClusterRouteIndexes(
        error,
        snapshot,
        routes,
      )) {
        residualDegreeByRouteIndex.set(
          routeIndex,
          (residualDegreeByRouteIndex.get(routeIndex) ?? 0) + 1,
        )
      }
    }

    const degreeDescending = (
      left: number,
      right: number,
      indexDirection: 1 | -1,
    ) =>
      (residualDegreeByRouteIndex.get(right) ?? 0) -
        (residualDegreeByRouteIndex.get(left) ?? 0) ||
      (left - right) * indexDirection
    const ascendingIndexOrder = [...residualDegreeByRouteIndex.keys()].sort(
      (left, right) => degreeDescending(left, right, 1),
    )
    if (ascendingIndexOrder.length <= 1) return [ascendingIndexOrder]

    const descendingIndexOrder = [...ascendingIndexOrder].sort((left, right) =>
      degreeDescending(left, right, -1),
    )
    return [ascendingIndexOrder, descendingIndexOrder]
  }

  private getErrorOwnedClusterPlans(
    snapshot: DrcSnapshot,
    routes: HighDensityRoute[],
  ): ErrorOwnedClusterPlan[] {
    const degreeDescendingOrders = this.getErrorOwnedClusterOrders(
      snapshot,
      routes,
    ).filter((order) => order.length > 0)
    return [
      ...degreeDescendingOrders.map((routeIndexes) => ({
        routeIndexes,
        reverse: false,
        allowTerminalEscape: routeIndexes.length <= 2,
      })),
      ...degreeDescendingOrders.map((routeIndexes) => ({
        routeIndexes: routeIndexes.toReversed(),
        reverse: true,
        allowTerminalEscape: true,
      })),
    ]
  }

  private runB01ErrorOwnedClusterRebuild(
    routes: HighDensityRoute[],
  ): HighDensityRoute[] {
    const baselineSnapshot = this.getSnapshot(routes)
    if (baselineSnapshot.count === 0) return routes

    const plans = this.getErrorOwnedClusterPlans(baselineSnapshot, routes)
    const seenPlans = new Set<string>()
    const failedFirstRouteAttempts = new Set<string>()

    for (const plan of plans) {
      const planKey = `${plan.reverse ? "reverse" : "forward"}:${plan.routeIndexes.join(",")}`
      if (
        seenPlans.has(planKey) ||
        this.errorOwnedClusterIterations >= MAX_ERROR_OWNED_CLUSTER_ITERATIONS
      ) {
        continue
      }
      seenPlans.add(planKey)
      this.errorOwnedClusterOrderAttempts += 1

      const candidateRoutes = cloneRoutes(routes)
      const pendingRouteIndexes = new Set(plan.routeIndexes)
      const rebuiltRouteIndexes: number[] = []
      let completed = true

      for (const routeIndex of plan.routeIndexes) {
        const firstRouteAttemptKey = [
          plan.reverse ? "reverse" : "forward",
          routeIndex,
          ...[...pendingRouteIndexes].sort((left, right) => left - right),
        ].join(":")
        if (
          rebuiltRouteIndexes.length === 0 &&
          failedFirstRouteAttempts.has(firstRouteAttemptKey)
        ) {
          completed = false
          break
        }
        const remainingIterations =
          MAX_ERROR_OWNED_CLUSTER_ITERATIONS - this.errorOwnedClusterIterations
        if (remainingIterations <= 0) {
          completed = false
          break
        }

        pendingRouteIndexes.delete(routeIndex)
        this.errorOwnedClusterRouteAttempts += 1
        let result = this.b01Rerouter.tryReroute(candidateRoutes, {
          routeIndex,
          omitCandidateRouteIndexes: pendingRouteIndexes,
          includeCandidateCopper: true,
          reverse: plan.reverse,
          shortenPath: false,
          maxIterations: Math.min(
            MAX_ERROR_OWNED_CLUSTER_ROUTE_ITERATIONS,
            remainingIterations,
          ),
        })
        this.errorOwnedClusterIterations += Math.max(0, result?.iterations ?? 0)
        if (
          (!result?.route || !routeHasValidLayerTransitions(result.route)) &&
          plan.allowTerminalEscape
        ) {
          for (const candidate of this.b01Rerouter
            .getTerminalViaEscapeCandidates(candidateRoutes, routeIndex)
            .slice(0, MAX_ERROR_OWNED_CLUSTER_TERMINAL_ESCAPE_CANDIDATES)) {
            const terminalRemainingIterations =
              MAX_ERROR_OWNED_CLUSTER_ITERATIONS -
              this.errorOwnedClusterIterations
            if (terminalRemainingIterations <= 0) break

            this.errorOwnedClusterTerminalEscapeAttempts += 1
            const terminalResult =
              this.b01Rerouter.tryRerouteWithTerminalViaEscape(
                candidateRoutes,
                {
                  routeIndex,
                  omitCandidateRouteIndexes: pendingRouteIndexes,
                  candidate,
                  includeCandidateCopper: true,
                  reverse: plan.reverse,
                  shortenPath: false,
                  maxIterations: Math.min(
                    MAX_ERROR_OWNED_CLUSTER_TERMINAL_ESCAPE_ITERATIONS,
                    terminalRemainingIterations,
                  ),
                },
              )
            this.errorOwnedClusterIterations += Math.max(
              0,
              terminalResult?.iterations ?? 0,
            )
            if (
              terminalResult?.route &&
              routeHasValidLayerTransitions(terminalResult.route)
            ) {
              result = terminalResult
              break
            }
          }
        }
        if (!result?.route || !routeHasValidLayerTransitions(result.route)) {
          if (rebuiltRouteIndexes.length === 0) {
            failedFirstRouteAttempts.add(firstRouteAttemptKey)
          }
          completed = false
          break
        }

        candidateRoutes[routeIndex] = result.route
        rebuiltRouteIndexes.push(routeIndex)
      }

      if (!completed) continue
      const materializedCandidate = materializeRoutes(candidateRoutes)
      if (
        !this.candidatePreservesTerminals(materializedCandidate) ||
        rebuiltRouteIndexes.some((routeIndex) => {
          const route = materializedCandidate[routeIndex]
          return !route || !routeHasValidLayerTransitions(route)
        })
      ) {
        continue
      }

      this.errorOwnedClusterDrcEvaluations += 1
      this.cleanupCandidateAttempts += 1
      const candidateSnapshot = this.getSnapshot(materializedCandidate)
      if (
        !this.snapshotImprovesWithoutFixedCopperRegression(
          candidateSnapshot,
          baselineSnapshot,
        )
      ) {
        continue
      }

      let acceptedRoutes = materializedCandidate
      let acceptedSnapshot = candidateSnapshot
      const postClusterOrder = this.getErrorOwnedClusterOrders(
        acceptedSnapshot,
        acceptedRoutes,
      )[0]
      for (const routeIndex of postClusterOrder ?? []) {
        if (
          acceptedSnapshot.count === 0 ||
          this.errorOwnedClusterIterations >= MAX_ERROR_OWNED_CLUSTER_ITERATIONS
        ) {
          break
        }

        const remainingIterations =
          MAX_ERROR_OWNED_CLUSTER_ITERATIONS - this.errorOwnedClusterIterations
        this.errorOwnedClusterRouteAttempts += 1
        this.errorOwnedClusterPostRouteAttempts += 1
        const result = this.b01Rerouter.tryReroute(acceptedRoutes, {
          routeIndex,
          includeCandidateCopper: true,
          reverse: false,
          shortenPath: false,
          maxIterations: Math.min(
            MAX_ERROR_OWNED_CLUSTER_ROUTE_ITERATIONS,
            remainingIterations,
          ),
        })
        this.errorOwnedClusterIterations += Math.max(0, result?.iterations ?? 0)
        if (!result?.route || !routeHasValidLayerTransitions(result.route)) {
          continue
        }

        const postCandidateRoutes = cloneRoutes(acceptedRoutes)
        postCandidateRoutes[routeIndex] = result.route
        const materializedPostCandidate = materializeRoutes(postCandidateRoutes)
        if (
          !this.candidatePreservesTerminals(materializedPostCandidate) ||
          !routeHasValidLayerTransitions(materializedPostCandidate[routeIndex]!)
        ) {
          continue
        }

        this.errorOwnedClusterDrcEvaluations += 1
        this.cleanupCandidateAttempts += 1
        const postCandidateSnapshot = this.getSnapshot(
          materializedPostCandidate,
        )
        if (
          !this.snapshotImprovesWithoutFixedCopperRegression(
            postCandidateSnapshot,
            acceptedSnapshot,
          )
        ) {
          continue
        }

        acceptedRoutes = materializedPostCandidate
        acceptedSnapshot = postCandidateSnapshot
        this.errorOwnedClusterPostCandidatesAccepted += 1
        this.cleanupCandidatesAccepted += 1
      }

      this.errorOwnedClusterAccepted += 1
      this.cleanupCandidatesAccepted += 1
      return acceptedRoutes
    }

    return routes
  }

  private runB01ErrorOwnedClusterRebuildPasses(
    routes: HighDensityRoute[],
  ): HighDensityRoute[] {
    let improvedRoutes = routes
    for (let pass = 0; pass < MAX_ERROR_OWNED_CLUSTER_PASSES; pass += 1) {
      const issueCountBeforePass = this.getSnapshot(improvedRoutes).count
      if (
        issueCountBeforePass === 0 ||
        this.errorOwnedClusterIterations >= MAX_ERROR_OWNED_CLUSTER_ITERATIONS
      ) {
        break
      }

      const candidateRoutes =
        this.runB01ErrorOwnedClusterRebuild(improvedRoutes)
      const issueCountAfterPass = this.getSnapshot(candidateRoutes).count
      if (issueCountAfterPass >= issueCountBeforePass) break
      improvedRoutes = candidateRoutes
    }
    return improvedRoutes
  }

  private runPostClusterViaMicroShiftCleanup(
    routes: HighDensityRoute[],
  ): HighDensityRoute[] {
    const baseLimit = this.selectedLocalCleanupDrcEvaluationLimit
    const evaluationsBeforeSweep = this.localCleanupDrcEvaluations
    const consecutiveMissesBeforeSweep = this.consecutiveLocalCleanupDrcMisses
    this.selectedLocalCleanupDrcEvaluationLimit =
      Math.max(baseLimit, evaluationsBeforeSweep) +
      MAX_POST_CLUSTER_VIA_MICRO_SHIFT_DRC_EVALUATIONS
    // This sweep has its own explicit evaluation allowance, so a stalled
    // earlier local phase must not consume it.
    this.consecutiveLocalCleanupDrcMisses = 0
    try {
      return this.runViaMicroShiftCleanup(routes)
    } finally {
      this.postClusterViaMicroShiftDrcEvaluations +=
        this.localCleanupDrcEvaluations - evaluationsBeforeSweep
      this.selectedLocalCleanupDrcEvaluationLimit = baseLimit
      this.consecutiveLocalCleanupDrcMisses = consecutiveMissesBeforeSweep
    }
  }

  private getRemainingFinalOwnerIterations(): number {
    return Math.max(
      0,
      this.finalOwnerIterationLimit - this.finalOwnerIterations,
    )
  }

  private getFinalOwnerErrorKey(
    routeIndex: number,
    snapshot: DrcSnapshot,
  ): string {
    return snapshot.errors
      .filter((error) =>
        this.getCandidateRouteIndexesForError(error, snapshot).includes(
          routeIndex,
        ),
      )
      .map((error) =>
        String(
          error.pcb_trace_error_id ??
            error.pcb_via_trace_clearance_error_id ??
            error.pcb_pad_trace_clearance_error_id ??
            error.pcb_via_clearance_error_id ??
            error.error_type ??
            error.type,
        ),
      )
      .sort()
      .join("|")
  }

  private getFinalOwnerInteriorWindows(
    route: HighDensityRoute,
    center: { x: number; y: number },
  ): Array<{ startIndex: number; endIndex: number }> {
    let nearestSegmentIndex = -1
    let nearestDistance = Number.POSITIVE_INFINITY
    for (
      let segmentIndex = 0;
      segmentIndex < route.route.length - 1;
      segmentIndex += 1
    ) {
      const start = route.route[segmentIndex]
      const end = route.route[segmentIndex + 1]
      if (!start || !end || start.z !== end.z) continue
      const distance = getPointToSegmentDistance(center, start, end)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestSegmentIndex = segmentIndex
      }
    }
    if (nearestSegmentIndex < 0) return []

    return this.getInteriorRerouteWindows(route, center).toSorted(
      (left, right) =>
        Math.abs(
          (left.startIndex + left.endIndex - 1) / 2 - nearestSegmentIndex,
        ) -
          Math.abs(
            (right.startIndex + right.endIndex - 1) / 2 - nearestSegmentIndex,
          ) ||
        left.endIndex - left.startIndex - (right.endIndex - right.startIndex) ||
        left.startIndex - right.startIndex,
    )
  }

  private tryFinalOwnerB01Candidate(
    routes: HighDensityRoute[],
    snapshot: DrcSnapshot,
    options: Omit<Pipeline9B01RerouteOptions, "maxIterations">,
    maxIterations: number,
    kind: "full" | "interior",
  ):
    | {
        routes: HighDensityRoute[]
        snapshot: DrcSnapshot
      }
    | undefined {
    const iterationLimit = Math.min(
      maxIterations,
      this.getRemainingFinalOwnerIterations(),
    )
    if (iterationLimit <= 0) return undefined

    if (kind === "full") this.finalOwnerFullAttempts += 1
    else this.finalOwnerInteriorAttempts += 1
    const result = this.b01Rerouter.tryReroute(routes, {
      ...options,
      maxIterations: iterationLimit,
    })
    this.finalOwnerIterations += Math.max(0, result?.iterations ?? 0)
    if (!result?.route || !routeHasValidLayerTransitions(result.route)) {
      return undefined
    }

    const candidateRoutes = cloneRoutes(routes)
    candidateRoutes[options.routeIndex] = result.route
    const materializedCandidate = materializeRoutes(candidateRoutes)
    const materializedRoute = materializedCandidate[options.routeIndex]
    if (
      !materializedRoute ||
      !routeHasValidLayerTransitions(materializedRoute) ||
      !this.candidatePreservesTerminals(materializedCandidate)
    ) {
      return undefined
    }

    this.finalOwnerDrcEvaluations += 1
    this.cleanupCandidateAttempts += 1
    const candidateSnapshot = this.getSnapshot(materializedCandidate)
    if (
      !this.snapshotImprovesWithoutFixedCopperRegression(
        candidateSnapshot,
        snapshot,
      )
    ) {
      return undefined
    }

    this.finalOwnerCandidatesAccepted += 1
    this.cleanupCandidatesAccepted += 1
    return {
      routes: materializedCandidate,
      snapshot: candidateSnapshot,
    }
  }

  private runB01FinalErrorOwnerSweep(
    routes: HighDensityRoute[],
  ): HighDensityRoute[] {
    let improvedRoutes = routes
    let snapshot = this.getSnapshot(improvedRoutes)
    const failedFullAttempts = new Set<string>()
    const failedInteriorAttempts = new Set<string>()

    repairLoop: while (
      snapshot.count > 0 &&
      this.getRemainingFinalOwnerIterations() > 0
    ) {
      let acceptedCandidate:
        | {
            routes: HighDensityRoute[]
            snapshot: DrcSnapshot
          }
        | undefined
      const routeIndexes = this.getOrderedB01RouteIndexes(snapshot)

      fullLoop: for (const variant of FINAL_OWNER_FULL_VARIANTS) {
        for (const routeIndex of routeIndexes) {
          const route = improvedRoutes[routeIndex]
          if (!route) continue
          const isLongRoute =
            route.route.length > MAX_FINAL_OWNER_FULL_VARIANT_ROUTE_POINTS
          if (isLongRoute && (variant.reverse || variant.shortenPath)) continue

          const attemptKey = [
            routeIndex,
            this.getFinalOwnerErrorKey(routeIndex, snapshot),
            variant.reverse ? "reverse" : "forward",
            variant.shortenPath ? "short" : "raw",
          ].join(":")
          if (failedFullAttempts.has(attemptKey)) continue

          const remainingForFullRoute =
            this.getRemainingFinalOwnerIterations() -
            FINAL_OWNER_INTERIOR_ITERATION_RESERVE
          if (remainingForFullRoute <= 0) break fullLoop
          const perAttemptLimit = isLongRoute
            ? MAX_FINAL_OWNER_LONG_ROUTE_ITERATIONS
            : variant.reverse || variant.shortenPath
              ? MAX_FINAL_OWNER_VARIANT_ITERATIONS
              : MAX_FINAL_OWNER_FULL_ROUTE_ITERATIONS
          acceptedCandidate = this.tryFinalOwnerB01Candidate(
            improvedRoutes,
            snapshot,
            {
              routeIndex,
              includeCandidateCopper: true,
              ...variant,
            },
            Math.min(perAttemptLimit, remainingForFullRoute),
            "full",
          )
          if (acceptedCandidate) break fullLoop
          failedFullAttempts.add(attemptKey)
        }
      }

      if (acceptedCandidate) {
        improvedRoutes = acceptedCandidate.routes
        snapshot = acceptedCandidate.snapshot
        // A successful reroute changes the candidate-copper obstacle field.
        // Attempts that failed against the previous geometry must be eligible
        // again even when their DRC error identifiers did not change.
        failedFullAttempts.clear()
        failedInteriorAttempts.clear()
        continue
      }

      interiorLoop: for (const error of snapshot.errors) {
        const center = this.getErrorCenter(error)
        if (!center) continue
        for (const routeIndex of this.getCandidateRouteIndexesForError(
          error,
          snapshot,
        )) {
          const route = improvedRoutes[routeIndex]
          if (!route) continue
          for (const window of this.getFinalOwnerInteriorWindows(
            route,
            center,
          )) {
            const attemptKey = [
              routeIndex,
              this.getFinalOwnerErrorKey(routeIndex, snapshot),
              window.startIndex,
              window.endIndex,
            ].join(":")
            if (failedInteriorAttempts.has(attemptKey)) continue
            const remainingIterations = this.getRemainingFinalOwnerIterations()
            if (remainingIterations <= 0) break repairLoop

            acceptedCandidate = this.tryFinalOwnerB01Candidate(
              improvedRoutes,
              snapshot,
              {
                routeIndex,
                ...window,
                includeCandidateCopper: true,
                reverse: true,
                shortenPath: false,
              },
              Math.min(
                MAX_FINAL_OWNER_INTERIOR_ITERATIONS,
                remainingIterations,
              ),
              "interior",
            )
            if (acceptedCandidate) break interiorLoop
            failedInteriorAttempts.add(attemptKey)
          }
        }
      }

      if (acceptedCandidate) {
        improvedRoutes = acceptedCandidate.routes
        snapshot = acceptedCandidate.snapshot
        failedFullAttempts.clear()
        failedInteriorAttempts.clear()
        continue
      }

      if (snapshot.count <= MAX_FINAL_OWNER_FALLBACK_RESIDUAL) {
        fallbackLoop: for (const variant of FINAL_OWNER_FULL_VARIANTS) {
          for (const routeIndex of this.getOrderedB01RouteIndexes(snapshot)) {
            const remainingIterations = this.getRemainingFinalOwnerIterations()
            if (remainingIterations <= 0) break fallbackLoop
            acceptedCandidate = this.tryFinalOwnerB01Candidate(
              improvedRoutes,
              snapshot,
              {
                routeIndex,
                includeCandidateCopper: true,
                ...variant,
              },
              remainingIterations,
              "full",
            )
            if (acceptedCandidate) break fallbackLoop
          }
        }
      }

      if (!acceptedCandidate) break
      improvedRoutes = acceptedCandidate.routes
      snapshot = acceptedCandidate.snapshot
      failedFullAttempts.clear()
      failedInteriorAttempts.clear()
    }

    return improvedRoutes
  }

  private normalizeViaMetadataFromLayerTransitions(
    routes: HighDensityRoute[],
  ): HighDensityRoute[] {
    return normalizePipeline9ViaMetadataFromLayerTransitions(routes)
  }

  private getCanonicalNetForRoute(route: HighDensityRoute): string | undefined {
    return this.params.connMap?.getNetConnectedToId(route.connectionName)
  }

  private tryScopedSameNetViaMerge(
    routes: HighDensityRoute[],
    ownerRouteIndex: number,
    maxIterations: number,
  ): ScopedSameNetViaMergeResult {
    const connMap = this.params.connMap
    const ownerRoute = routes[ownerRouteIndex]
    const canonicalNet = ownerRoute && this.getCanonicalNetForRoute(ownerRoute)
    if (!connMap || !ownerRoute || !canonicalNet || maxIterations <= 0) {
      return { iterations: 0, mergedViaCount: 0 }
    }

    const scopedRouteIndexes = routes.flatMap((route, routeIndex) =>
      this.getCanonicalNetForRoute(route) === canonicalNet ? [routeIndex] : [],
    )
    if (scopedRouteIndexes.length === 0) {
      return { iterations: 0, mergedViaCount: 0 }
    }

    const scopedRoutes = this.normalizeViaMetadataFromLayerTransitions(
      scopedRouteIndexes.map((routeIndex) => routes[routeIndex]!),
    )
    let merger: SameNetViaMergerSolver | undefined
    try {
      merger = new SameNetViaMergerSolver({
        inputHdRoutes: scopedRoutes,
        obstacles: this.params.srj.obstacles,
        colorMap: {},
        layerCount: this.params.srj.layerCount,
        connMap,
      })
      while (
        !merger.solved &&
        !merger.failed &&
        merger.iterations < maxIterations
      ) {
        merger.step()
      }
    } catch {
      return {
        iterations: Math.min(maxIterations, merger?.iterations ?? 0),
        mergedViaCount: 0,
      }
    }

    const iterations = Math.min(maxIterations, merger.iterations)
    const mergedViaCount = Number(merger.stats.mergedViaCount) || 0
    const mergedScopedRoutes = merger.getMergedViaHdRoutes()
    if (
      !merger.solved ||
      merger.failed ||
      mergedViaCount <= 0 ||
      !mergedScopedRoutes ||
      mergedScopedRoutes.length !== scopedRouteIndexes.length
    ) {
      return { iterations, mergedViaCount: 0 }
    }

    const mergedRoutes = cloneRoutes(routes)
    for (const [scopedIndex, routeIndex] of scopedRouteIndexes.entries()) {
      mergedRoutes[routeIndex] = mergedScopedRoutes[scopedIndex]!
    }
    return {
      routes: materializeRoutes(mergedRoutes),
      iterations,
      mergedViaCount,
    }
  }

  private runPostRepairSameNetViaMerge(
    routes: HighDensityRoute[],
  ): HighDensityRoute[] {
    let improvedRoutes = routes
    let baselineSnapshot = this.getSnapshot(improvedRoutes)
    if (
      baselineSnapshot.count === 0 ||
      !baselineSnapshot.errors.some(
        (error) => getErrorType(error) === "pcb_via_clearance_error",
      )
    ) {
      return routes
    }
    if (!this.params.connMap) return routes

    const orderedOwnerRouteIndexes: number[] = []
    const seenCanonicalNets = new Set<string>()
    const addOwner = (routeIndex: number) => {
      const route = improvedRoutes[routeIndex]
      const canonicalNet = route && this.getCanonicalNetForRoute(route)
      if (!canonicalNet || seenCanonicalNets.has(canonicalNet)) return
      seenCanonicalNets.add(canonicalNet)
      orderedOwnerRouteIndexes.push(routeIndex)
    }

    for (const error of baselineSnapshot.errors) {
      if (getErrorType(error) !== "pcb_via_clearance_error") continue
      for (const routeIndex of this.getCandidateRouteIndexesForError(
        error,
        baselineSnapshot,
      )) {
        addOwner(routeIndex)
      }
    }
    for (const routeIndex of improvedRoutes.keys()) addOwner(routeIndex)

    for (const ownerRouteIndex of orderedOwnerRouteIndexes) {
      const remainingIterations =
        MAX_POST_REPAIR_SAME_NET_VIA_MERGER_ITERATIONS -
        this.postRepairSameNetViaMergeIterations
      if (remainingIterations <= 0) break

      this.postRepairSameNetViaMergeAttempts += 1
      const mergeResult = this.tryScopedSameNetViaMerge(
        improvedRoutes,
        ownerRouteIndex,
        remainingIterations,
      )
      this.postRepairSameNetViaMergeIterations += mergeResult.iterations
      const materializedCandidate = mergeResult.routes
      if (
        !materializedCandidate ||
        !this.candidatePreservesTerminals(materializedCandidate) ||
        materializedCandidate.some(
          (route) => !routeHasValidLayerTransitions(route),
        )
      ) {
        continue
      }

      this.postRepairSameNetViaMergeDrcEvaluations += 1
      this.cleanupCandidateAttempts += 1
      const candidateSnapshot = this.getSnapshot(materializedCandidate)
      if (
        !this.snapshotImprovesWithoutFixedCopperRegression(
          candidateSnapshot,
          baselineSnapshot,
        )
      ) {
        continue
      }

      this.postRepairSameNetViaMergeCandidatesAccepted += 1
      this.cleanupCandidatesAccepted += 1
      improvedRoutes = materializedCandidate
      baselineSnapshot = candidateSnapshot
      if (baselineSnapshot.count === 0) break
    }

    return improvedRoutes
  }

  private getDrcErrorIdentifier(error: DrcError, errorIndex: number): string {
    for (const key of [
      "pcb_trace_error_id",
      "pcb_error_id",
      "pcb_via_trace_clearance_error_id",
      "pcb_pad_trace_clearance_error_id",
      "pcb_via_clearance_error_id",
    ]) {
      const identifier = error[key]
      if (typeof identifier === "string") return identifier
    }
    return `${getErrorType(error) ?? "unknown"}:${errorIndex}`
  }

  private getSharedTerminalCompositeGroups(
    routes: HighDensityRoute[],
    snapshot: DrcSnapshot,
  ): SharedTerminalCompositeGroup[] {
    if (
      snapshot.count === 0 ||
      snapshot.count > MAX_SHARED_TERMINAL_COMPOSITE_RESIDUAL ||
      !this.params.connMap
    ) {
      return []
    }

    const candidatesByFixedTraceAndNet = new Map<
      string,
      {
        fixedTraceId: string
        canonicalNet: string
        routeIndexes: Set<number>
        baselineErrorIds: Set<string>
      }
    >()
    for (const [errorIndex, error] of snapshot.errors.entries()) {
      if (
        getErrorType(error) !== "pcb_trace_error" ||
        getPhysicalPadIdFromError(error)
      ) {
        continue
      }
      const candidateRouteIndexes = this.getCandidateRouteIndexesForError(
        error,
        snapshot,
      )
      if (candidateRouteIndexes.length !== 1) continue
      const routeIndex = candidateRouteIndexes[0]!
      const route = routes[routeIndex]
      const canonicalNet = route && this.getCanonicalNetForRoute(route)
      if (!route || !canonicalNet) continue

      const referencedTraceIds = [
        typeof error.pcb_trace_id === "string" ? error.pcb_trace_id : undefined,
        getRawOtherTraceId(error),
      ].filter((traceId): traceId is string => Boolean(traceId))
      const fixedTraceIds = [
        ...new Set(
          referencedTraceIds.filter(
            (traceId) => !snapshot.traceRouteIndexById.has(traceId),
          ),
        ),
      ]
      if (fixedTraceIds.length !== 1) continue
      const fixedTraceId = fixedTraceIds[0]!
      const key = `${fixedTraceId}:${canonicalNet}`
      const candidate = candidatesByFixedTraceAndNet.get(key) ?? {
        fixedTraceId,
        canonicalNet,
        routeIndexes: new Set<number>(),
        baselineErrorIds: new Set<string>(),
      }
      candidate.routeIndexes.add(routeIndex)
      candidate.baselineErrorIds.add(
        this.getDrcErrorIdentifier(error, errorIndex),
      )
      candidatesByFixedTraceAndNet.set(key, candidate)
    }

    const groups: SharedTerminalCompositeGroup[] = []
    for (const candidate of candidatesByFixedTraceAndNet.values()) {
      const routeIndexes = [...candidate.routeIndexes]
      if (routeIndexes.length < 2) continue

      let commonPortIds: Set<string> | undefined
      for (const routeIndex of routeIndexes) {
        const routePortIds = new Set(
          this.terminalConstraints.flatMap((constraint) =>
            constraint.routeIndex === routeIndex &&
            typeof constraint.originalPoint.pcb_port_id === "string"
              ? [constraint.originalPoint.pcb_port_id]
              : [],
          ),
        )
        commonPortIds =
          commonPortIds === undefined
            ? routePortIds
            : new Set(
                [...commonPortIds].filter((portId) => routePortIds.has(portId)),
              )
      }

      for (const terminalPortId of [...(commonPortIds ?? [])].sort()) {
        const branches = routeIndexes.flatMap((routeIndex) => {
          const constraint = this.terminalConstraints.find(
            (candidateConstraint) =>
              candidateConstraint.routeIndex === routeIndex &&
              candidateConstraint.originalPoint.pcb_port_id === terminalPortId,
          )
          return constraint
            ? [{ routeIndex, endpoint: constraint.endpoint }]
            : []
        })
        if (branches.length !== routeIndexes.length) continue
        groups.push({
          fixedTraceId: candidate.fixedTraceId,
          canonicalNet: candidate.canonicalNet,
          terminalPortId,
          branches,
          baselineErrorIds: new Set(candidate.baselineErrorIds),
        })
      }
    }
    return groups
  }

  private terminalCanHostRelocatedVia(
    routes: HighDensityRoute[],
    routeIndex: number,
    endpoint: "start" | "end",
  ): boolean {
    const route = routes[routeIndex]
    const terminal =
      endpoint === "start" ? route?.route[0] : route?.route.at(-1)
    const constraint = this.terminalConstraints.find(
      (candidate) =>
        candidate.routeIndex === routeIndex && candidate.endpoint === endpoint,
    )
    if (!route || !terminal || !constraint) return false

    const viaRadius = (route.viaDiameter ?? this.params.srj.minViaDiameter) / 2
    const bounds = this.params.srj.bounds
    if (
      terminal.x < bounds.minX + viaRadius - POSITION_EPSILON ||
      terminal.x > bounds.maxX - viaRadius + POSITION_EPSILON ||
      terminal.y < bounds.minY + viaRadius - POSITION_EPSILON ||
      terminal.y > bounds.maxY - viaRadius + POSITION_EPSILON
    ) {
      return false
    }

    return constraint.owningObstacles.some(
      (obstacle) =>
        obstacle.connectedTo.some(
          (id) =>
            id.startsWith("pcb_smtpad_") || id.startsWith("pcb_plated_hole_"),
        ) && pointFitsInsideObstacle(terminal, obstacle, viaRadius),
    )
  }

  private relocateNearestTransitionToTerminal(
    route: HighDensityRoute,
    endpoint: "start" | "end",
  ): HighDensityRoute | undefined {
    const terminal = endpoint === "start" ? route.route[0] : route.route.at(-1)
    if (!terminal || route.route.length < 3) return undefined

    const transitionIndexes: number[] = []
    for (
      let pointIndex = 0;
      pointIndex < route.route.length - 1;
      pointIndex += 1
    ) {
      const point = route.route[pointIndex]
      const nextPoint = route.route[pointIndex + 1]
      if (
        point &&
        nextPoint &&
        point.z !== nextPoint.z &&
        getPointDistance(point, nextPoint) <= POSITION_EPSILON
      ) {
        transitionIndexes.push(pointIndex)
      }
    }
    const transitionIndex =
      endpoint === "start" ? transitionIndexes[0] : transitionIndexes.at(-1)
    if (transitionIndex === undefined) return undefined

    const transitionStart = route.route[transitionIndex]!
    const transitionEnd = route.route[transitionIndex + 1]!
    const oppositeZ =
      terminal.z === transitionStart.z
        ? transitionEnd.z
        : terminal.z === transitionEnd.z
          ? transitionStart.z
          : undefined
    if (
      oppositeZ === undefined ||
      oppositeZ === terminal.z ||
      oppositeZ < 0 ||
      oppositeZ >= this.params.srj.layerCount
    ) {
      return undefined
    }

    const { pcb_port_id: _pcbPortId, ...terminalWithoutPortId } = terminal
    const oppositeTerminal = {
      ...terminalWithoutPortId,
      z: oppositeZ,
    }
    const relocatedPoints =
      endpoint === "start"
        ? [
            { ...terminal },
            oppositeTerminal,
            ...route.route.slice(transitionIndex + 2),
          ]
        : [
            ...route.route.slice(0, transitionIndex),
            oppositeTerminal,
            { ...terminal },
          ]
    if (relocatedPoints.length < 2) return undefined
    return { ...route, route: relocatedPoints }
  }

  private runSharedTerminalCompositeRepair(
    routes: HighDensityRoute[],
  ): HighDensityRoute[] {
    const baselineSnapshot = this.getSnapshot(routes)
    const groups = this.getSharedTerminalCompositeGroups(
      routes,
      baselineSnapshot,
    )
    for (const group of groups) {
      if (
        this.sharedTerminalCompositeAttempts >=
          MAX_SHARED_TERMINAL_COMPOSITE_ATTEMPTS ||
        this.sharedTerminalCompositeDrcEvaluations >=
          MAX_SHARED_TERMINAL_COMPOSITE_DRC_EVALUATIONS
      ) {
        break
      }
      if (
        group.branches.some(
          ({ routeIndex, endpoint }) =>
            !this.terminalCanHostRelocatedVia(routes, routeIndex, endpoint),
        )
      ) {
        continue
      }

      const relocatedRoutes = cloneRoutes(routes)
      let relocationIsValid = true
      for (const { routeIndex, endpoint } of group.branches) {
        const relocatedRoute = this.relocateNearestTransitionToTerminal(
          relocatedRoutes[routeIndex]!,
          endpoint,
        )
        if (!relocatedRoute) {
          relocationIsValid = false
          break
        }
        relocatedRoutes[routeIndex] = relocatedRoute
      }
      if (!relocationIsValid) continue

      this.sharedTerminalCompositeAttempts += 1
      this.sharedTerminalCompositeRelocatedBranches += group.branches.length
      let atomicCandidate =
        this.normalizeViaMetadataFromLayerTransitions(relocatedRoutes)
      if (
        atomicCandidate.some(
          (route) => !routeHasValidLayerTransitions(route),
        ) ||
        !this.candidatePreservesTerminals(atomicCandidate)
      ) {
        continue
      }

      this.sharedTerminalCompositeDrcEvaluations += 1
      this.cleanupCandidateAttempts += 1
      const relocatedSnapshot = this.getSnapshot(atomicCandidate)
      if (
        this.snapshotImprovesWithoutFixedCopperRegression(
          relocatedSnapshot,
          baselineSnapshot,
        )
      ) {
        this.sharedTerminalCompositeCandidatesAccepted += 1
        this.cleanupCandidatesAccepted += 1
        return atomicCandidate
      }
      if (
        relocatedSnapshot.count > baselineSnapshot.count ||
        this.getFixedCopperIssueScore(relocatedSnapshot) >
          this.getFixedCopperIssueScore(baselineSnapshot)
      ) {
        continue
      }

      const relocatedErrorIds = new Set(
        relocatedSnapshot.errors.map((error, errorIndex) =>
          this.getDrcErrorIdentifier(error, errorIndex),
        ),
      )
      if (
        [...group.baselineErrorIds].some((errorId) =>
          relocatedErrorIds.has(errorId),
        )
      ) {
        continue
      }

      const branchRouteIndexes = new Set(
        group.branches.map(({ routeIndex }) => routeIndex),
      )
      const baselineErrorIds = new Set(
        baselineSnapshot.errors.map((error, errorIndex) =>
          this.getDrcErrorIdentifier(error, errorIndex),
        ),
      )
      const exposedOwnerSets = relocatedSnapshot.errors.flatMap(
        (error, errorIndex) => {
          if (
            baselineErrorIds.has(this.getDrcErrorIdentifier(error, errorIndex))
          ) {
            return []
          }
          const routeIndexes = this.getCandidateRouteIndexesForError(
            error,
            relocatedSnapshot,
          )
          if (
            !routeIndexes.some((routeIndex) =>
              branchRouteIndexes.has(routeIndex),
            )
          ) {
            return []
          }
          const exposedRouteIndexes = routeIndexes.filter(
            (routeIndex) => !branchRouteIndexes.has(routeIndex),
          )
          return exposedRouteIndexes.length > 0
            ? [new Set(exposedRouteIndexes)]
            : []
        },
      )
      if (exposedOwnerSets.length === 0) continue
      const commonExposedOwners = new Set(exposedOwnerSets[0])
      for (const ownerSet of exposedOwnerSets.slice(1)) {
        for (const routeIndex of commonExposedOwners) {
          if (!ownerSet.has(routeIndex)) commonExposedOwners.delete(routeIndex)
        }
      }
      if (commonExposedOwners.size !== 1) continue
      const exposedOwnerRouteIndex = [...commonExposedOwners][0]!

      const remainingIterations =
        MAX_SHARED_TERMINAL_COMPOSITE_B01_ITERATIONS -
        this.sharedTerminalCompositeIterations
      if (remainingIterations <= 0) break
      this.sharedTerminalCompositeB01Attempts += 1
      const rerouteResult = this.b01Rerouter.tryReroute(atomicCandidate, {
        routeIndex: exposedOwnerRouteIndex,
        includeCandidateCopper: true,
        reverse: false,
        shortenPath: false,
        maxIterations: remainingIterations,
      })
      this.sharedTerminalCompositeIterations += Math.min(
        remainingIterations,
        Math.max(0, rerouteResult?.iterations ?? 0),
      )
      if (
        !rerouteResult?.route ||
        !routeHasValidLayerTransitions(rerouteResult.route)
      ) {
        continue
      }

      atomicCandidate = cloneRoutes(atomicCandidate)
      atomicCandidate[exposedOwnerRouteIndex] = rerouteResult.route
      atomicCandidate =
        this.normalizeViaMetadataFromLayerTransitions(atomicCandidate)
      if (
        atomicCandidate.some(
          (route) => !routeHasValidLayerTransitions(route),
        ) ||
        !this.candidatePreservesTerminals(atomicCandidate) ||
        this.sharedTerminalCompositeDrcEvaluations >=
          MAX_SHARED_TERMINAL_COMPOSITE_DRC_EVALUATIONS
      ) {
        continue
      }

      this.sharedTerminalCompositeDrcEvaluations += 1
      this.cleanupCandidateAttempts += 1
      const candidateSnapshot = this.getSnapshot(atomicCandidate)
      if (
        !this.snapshotImprovesWithoutFixedCopperRegression(
          candidateSnapshot,
          baselineSnapshot,
        )
      ) {
        continue
      }

      this.sharedTerminalCompositeCandidatesAccepted += 1
      this.cleanupCandidatesAccepted += 1
      return atomicCandidate
    }

    return routes
  }

  private getPostFinalCompositeWindows(
    route: HighDensityRoute,
    center: { x: number; y: number },
  ): PostFinalCompositeWindow[] {
    if (route.route.length < 3) return []

    let nearestSegmentIndex = -1
    let nearestDistance = Number.POSITIVE_INFINITY
    for (
      let segmentIndex = 0;
      segmentIndex < route.route.length - 1;
      segmentIndex += 1
    ) {
      const start = route.route[segmentIndex]
      const end = route.route[segmentIndex + 1]
      if (!start || !end || start.z !== end.z) continue
      const distance = getPointToSegmentDistance(center, start, end)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestSegmentIndex = segmentIndex
      }
    }
    if (nearestSegmentIndex < 0) return []

    const lastPointIndex = route.route.length - 1
    const lastSegmentIndex = lastPointIndex - 1
    const lastInteriorIndex = lastPointIndex - 1
    const windows: PostFinalCompositeWindow[] = []
    const seenWindows = new Set<string>()
    const addWindow = (
      startIndex: number,
      endIndex: number,
      terminalRooted: boolean,
    ) => {
      if (
        startIndex < 0 ||
        endIndex > lastPointIndex ||
        startIndex >= endIndex ||
        startIndex > nearestSegmentIndex ||
        endIndex < nearestSegmentIndex + 1
      ) {
        return
      }
      const key = `${startIndex}:${endIndex}`
      if (seenWindows.has(key)) return
      seenWindows.add(key)
      windows.push({ startIndex, endIndex, terminalRooted })
    }

    if (nearestSegmentIndex <= POST_FINAL_COMPOSITE_TERMINAL_PROXIMITY) {
      let endIndex = Math.min(
        lastPointIndex,
        nearestSegmentIndex +
          1 +
          POST_FINAL_COMPOSITE_INTERIOR_EXPANSIONS.at(-1)!,
      )
      for (
        let pointIndex = nearestSegmentIndex;
        pointIndex < lastPointIndex;
        pointIndex += 1
      ) {
        if (route.route[pointIndex]!.z === route.route[pointIndex + 1]!.z) {
          continue
        }
        endIndex = Math.min(lastPointIndex, pointIndex + 2)
        break
      }
      addWindow(0, endIndex, true)
    }

    if (
      lastSegmentIndex - nearestSegmentIndex <=
      POST_FINAL_COMPOSITE_TERMINAL_PROXIMITY
    ) {
      let startIndex = Math.max(
        0,
        nearestSegmentIndex - POST_FINAL_COMPOSITE_INTERIOR_EXPANSIONS.at(-1)!,
      )
      for (
        let pointIndex = nearestSegmentIndex;
        pointIndex >= 0;
        pointIndex -= 1
      ) {
        if (route.route[pointIndex]!.z === route.route[pointIndex + 1]!.z) {
          continue
        }
        startIndex = Math.max(0, pointIndex - 1)
        break
      }
      addWindow(startIndex, lastPointIndex, true)
    }

    for (const expansion of POST_FINAL_COMPOSITE_INTERIOR_EXPANSIONS) {
      const startIndex = Math.max(1, nearestSegmentIndex - expansion)
      const endIndex = Math.min(
        lastInteriorIndex,
        nearestSegmentIndex + 1 + expansion,
      )
      addWindow(startIndex, endIndex, false)
    }

    return windows
  }

  private getRemainingPostFinalCompositeIterations(): number {
    return Math.max(
      0,
      MAX_POST_FINAL_COMPOSITE_B01_ITERATIONS -
        this.postFinalCompositeIterations,
    )
  }

  private tryPostFinalCompositeCandidate(
    routes: HighDensityRoute[],
    snapshot: DrcSnapshot,
    options: Omit<Pipeline9B01RerouteOptions, "maxIterations">,
    terminalRooted: boolean,
  ):
    | {
        routes: HighDensityRoute[]
        snapshot: DrcSnapshot
      }
    | undefined {
    const iterationLimit = Math.min(
      MAX_POST_FINAL_COMPOSITE_B01_ITERATIONS_PER_ATTEMPT,
      this.getRemainingPostFinalCompositeIterations(),
    )
    if (
      iterationLimit <= 0 ||
      this.postFinalCompositeAttempts >= MAX_POST_FINAL_COMPOSITE_ATTEMPTS ||
      this.postFinalCompositeDrcEvaluations >=
        MAX_POST_FINAL_COMPOSITE_DRC_EVALUATIONS
    ) {
      return undefined
    }

    this.postFinalCompositeAttempts += 1
    if (options.reverse) this.postFinalCompositeReverseAttempts += 1
    else this.postFinalCompositeForwardAttempts += 1
    if (terminalRooted) this.postFinalCompositeTerminalRootedAttempts += 1

    const result = this.b01Rerouter.tryReroute(routes, {
      ...options,
      maxIterations: iterationLimit,
    })
    this.postFinalCompositeIterations += Math.min(
      iterationLimit,
      Math.max(0, result?.iterations ?? 0),
    )
    if (!result?.route || !routeHasValidLayerTransitions(result.route)) {
      return undefined
    }

    const candidateRoutes = cloneRoutes(routes)
    candidateRoutes[options.routeIndex] = result.route
    const rawCandidate = materializeRoutes(candidateRoutes)
    if (
      rawCandidate.some((route) => !routeHasValidLayerTransitions(route)) ||
      !this.candidatePreservesTerminals(rawCandidate)
    ) {
      return undefined
    }

    this.postFinalCompositeDrcEvaluations += 1
    this.cleanupCandidateAttempts += 1
    const rawCandidateSnapshot = this.getSnapshot(rawCandidate)
    if (
      this.snapshotImprovesWithoutFixedCopperRegression(
        rawCandidateSnapshot,
        snapshot,
      )
    ) {
      this.postFinalCompositeCandidatesAccepted += 1
      this.cleanupCandidatesAccepted += 1
      return { routes: rawCandidate, snapshot: rawCandidateSnapshot }
    }
    if (
      this.postFinalCompositeDrcEvaluations >=
      MAX_POST_FINAL_COMPOSITE_DRC_EVALUATIONS
    ) {
      return undefined
    }

    const remainingViaMergeIterations =
      MAX_POST_FINAL_COMPOSITE_SAME_NET_VIA_MERGER_ITERATIONS -
      this.postFinalCompositeSameNetViaMergeIterations
    if (remainingViaMergeIterations <= 0) return undefined
    const mergeResult = this.tryScopedSameNetViaMerge(
      rawCandidate,
      options.routeIndex,
      Math.min(
        MAX_POST_FINAL_COMPOSITE_SAME_NET_VIA_MERGER_ITERATIONS_PER_ATTEMPT,
        remainingViaMergeIterations,
      ),
    )
    this.postFinalCompositeSameNetViaMergeIterations += mergeResult.iterations
    const atomicCandidate = mergeResult.routes
    if (!atomicCandidate) return undefined

    if (
      atomicCandidate.some((route) => !routeHasValidLayerTransitions(route)) ||
      !this.candidatePreservesTerminals(atomicCandidate)
    ) {
      return undefined
    }

    this.postFinalCompositeDrcEvaluations += 1
    this.cleanupCandidateAttempts += 1
    const atomicCandidateSnapshot = this.getSnapshot(atomicCandidate)
    if (
      !this.snapshotImprovesWithoutFixedCopperRegression(
        atomicCandidateSnapshot,
        snapshot,
      )
    ) {
      return undefined
    }

    this.postFinalCompositeCandidatesAccepted += 1
    this.cleanupCandidatesAccepted += 1
    return { routes: atomicCandidate, snapshot: atomicCandidateSnapshot }
  }

  private runPostFinalCompositeRepair(
    routes: HighDensityRoute[],
  ): HighDensityRoute[] {
    let improvedRoutes = routes
    let snapshot = this.getSnapshot(improvedRoutes)

    repairLoop: while (
      snapshot.count > 0 &&
      this.getRemainingPostFinalCompositeIterations() > 0 &&
      this.postFinalCompositeAttempts < MAX_POST_FINAL_COMPOSITE_ATTEMPTS &&
      this.postFinalCompositeDrcEvaluations <
        MAX_POST_FINAL_COMPOSITE_DRC_EVALUATIONS
    ) {
      const errors = snapshot.errors
        .map((error, errorIndex) => ({ error, errorIndex }))
        .toSorted(
          (left, right) =>
            Number(!getPhysicalPadIdFromError(left.error)) -
              Number(!getPhysicalPadIdFromError(right.error)) ||
            left.errorIndex - right.errorIndex,
        )

      for (const { error } of errors) {
        const center = this.getErrorCenter(error)
        if (!center) continue
        for (const routeIndex of this.getCandidateRouteIndexesForError(
          error,
          snapshot,
        )) {
          const route = improvedRoutes[routeIndex]
          if (!route) continue
          for (const window of this.getPostFinalCompositeWindows(
            route,
            center,
          )) {
            // Keep both search directions adjacent so neither is starved by
            // later windows or owners.
            for (const reverse of [false, true]) {
              const candidate = this.tryPostFinalCompositeCandidate(
                improvedRoutes,
                snapshot,
                {
                  routeIndex,
                  startIndex: window.startIndex,
                  endIndex: window.endIndex,
                  includeCandidateCopper: true,
                  reverse,
                  shortenPath: false,
                },
                window.terminalRooted,
              )
              if (!candidate) {
                if (
                  this.getRemainingPostFinalCompositeIterations() <= 0 ||
                  this.postFinalCompositeAttempts >=
                    MAX_POST_FINAL_COMPOSITE_ATTEMPTS ||
                  this.postFinalCompositeDrcEvaluations >=
                    MAX_POST_FINAL_COMPOSITE_DRC_EVALUATIONS
                ) {
                  break repairLoop
                }
                continue
              }

              improvedRoutes = candidate.routes
              snapshot = candidate.snapshot
              continue repairLoop
            }
          }
        }
      }

      break
    }

    return improvedRoutes
  }

  private getAnchoredFixedCopperWindow(
    routes: HighDensityRoute[],
    routeIndex: number,
    centers: ReadonlyArray<{ x: number; y: number }>,
  ): AnchoredFixedCopperWindow | undefined {
    const route = routes[routeIndex]
    if (!route || route.route.length < 2 || centers.length === 0) {
      return undefined
    }

    const cumulativeDistances = [0]
    for (
      let segmentIndex = 0;
      segmentIndex < route.route.length - 1;
      segmentIndex += 1
    ) {
      cumulativeDistances.push(
        cumulativeDistances[segmentIndex]! +
          getPointDistance(
            route.route[segmentIndex]!,
            route.route[segmentIndex + 1]!,
          ),
      )
    }
    const totalRouteDistance = cumulativeDistances.at(-1) ?? 0
    if (totalRouteDistance <= POSITION_EPSILON) return undefined

    const projectedRouteDistances: number[] = []
    for (const center of centers) {
      let nearestSegmentIndex = -1
      let nearestSegmentProjection = 0
      let nearestDistance = Number.POSITIVE_INFINITY
      for (
        let segmentIndex = 0;
        segmentIndex < route.route.length - 1;
        segmentIndex += 1
      ) {
        const start = route.route[segmentIndex]
        const end = route.route[segmentIndex + 1]
        if (!start || !end || start.z !== end.z) continue
        const segmentLength = getPointDistance(start, end)
        if (segmentLength <= POSITION_EPSILON) continue
        const distance = getPointToSegmentDistance(center, start, end)
        if (distance < nearestDistance) {
          const deltaX = end.x - start.x
          const deltaY = end.y - start.y
          nearestDistance = distance
          nearestSegmentIndex = segmentIndex
          nearestSegmentProjection = Math.max(
            0,
            Math.min(
              1,
              ((center.x - start.x) * deltaX + (center.y - start.y) * deltaY) /
                (segmentLength * segmentLength),
            ),
          )
        }
      }
      if (nearestSegmentIndex < 0) continue
      projectedRouteDistances.push(
        cumulativeDistances[nearestSegmentIndex]! +
          nearestSegmentProjection *
            getPointDistance(
              route.route[nearestSegmentIndex]!,
              route.route[nearestSegmentIndex + 1]!,
            ),
      )
    }
    if (projectedRouteDistances.length === 0) return undefined

    const startRouteDistance = Math.max(
      0,
      Math.min(...projectedRouteDistances) - ANCHORED_FIXED_COPPER_HALF_SPAN,
    )
    const endRouteDistance = Math.min(
      totalRouteDistance,
      Math.max(...projectedRouteDistances) + ANCHORED_FIXED_COPPER_HALF_SPAN,
    )
    if (endRouteDistance - startRouteDistance <= POSITION_EPSILON) {
      return undefined
    }

    const getAnchorAtRouteDistance = (
      routeDistance: number,
    ):
      | {
          segmentIndex: number
          point: HighDensityRoute["route"][number]
        }
      | undefined => {
      for (
        let segmentIndex = 0;
        segmentIndex < route.route.length - 1;
        segmentIndex += 1
      ) {
        const segmentStartDistance = cumulativeDistances[segmentIndex]!
        const segmentEndDistance = cumulativeDistances[segmentIndex + 1]!
        const segmentLength = segmentEndDistance - segmentStartDistance
        if (
          segmentLength <= POSITION_EPSILON ||
          routeDistance > segmentEndDistance + POSITION_EPSILON
        ) {
          continue
        }
        const segmentStart = route.route[segmentIndex]!
        const segmentEnd = route.route[segmentIndex + 1]!
        if (routeDistance <= segmentStartDistance + POSITION_EPSILON) {
          return { segmentIndex, point: { ...segmentStart } }
        }
        if (routeDistance >= segmentEndDistance - POSITION_EPSILON) {
          return { segmentIndex, point: { ...segmentEnd } }
        }
        const fraction = (routeDistance - segmentStartDistance) / segmentLength
        return {
          segmentIndex,
          point: {
            x: segmentStart.x + (segmentEnd.x - segmentStart.x) * fraction,
            y: segmentStart.y + (segmentEnd.y - segmentStart.y) * fraction,
            z: segmentStart.z,
            traceThickness: route.traceThickness,
          },
        }
      }
      return undefined
    }
    const startAnchor = getAnchorAtRouteDistance(startRouteDistance)
    const endAnchor = getAnchorAtRouteDistance(endRouteDistance)
    if (!startAnchor || !endAnchor) return undefined

    const anchoredPoints: HighDensityRoute["route"] = []
    const pushPoint = (point: HighDensityRoute["route"][number]): number => {
      const previousPoint = anchoredPoints.at(-1)
      if (
        previousPoint &&
        previousPoint.z === point.z &&
        getPointDistance(previousPoint, point) <= POSITION_EPSILON
      ) {
        anchoredPoints[anchoredPoints.length - 1] = { ...point }
        return anchoredPoints.length - 1
      }
      anchoredPoints.push({ ...point })
      return anchoredPoints.length - 1
    }
    let startIndex = -1
    let endIndex = -1
    for (
      let segmentIndex = 0;
      segmentIndex < route.route.length - 1;
      segmentIndex += 1
    ) {
      pushPoint(route.route[segmentIndex]!)
      if (segmentIndex === startAnchor.segmentIndex) {
        startIndex = pushPoint(startAnchor.point)
      }
      if (segmentIndex === endAnchor.segmentIndex) {
        endIndex = pushPoint(endAnchor.point)
      }
    }
    pushPoint(route.route.at(-1)!)
    if (startIndex < 0 || endIndex < 0 || startIndex >= endIndex) {
      return undefined
    }

    const anchoredRoutes = cloneRoutes(routes)
    anchoredRoutes[routeIndex] = {
      ...route,
      route: anchoredPoints,
    }
    return { routes: anchoredRoutes, startIndex, endIndex }
  }

  private getRemainingAnchoredFixedCopperIterations(): number {
    return Math.max(
      0,
      MAX_ANCHORED_FIXED_COPPER_ITERATIONS - this.anchoredFixedCopperIterations,
    )
  }

  private hasFixedTraceGeometryProgress(
    baselineRoutes: HighDensityRoute[],
    candidateRoutes: HighDensityRoute[],
    snapshot: DrcSnapshot,
    routeIndex: number,
  ): boolean {
    const baselineRoute = baselineRoutes[routeIndex]
    const candidateRoute = candidateRoutes[routeIndex]
    if (!baselineRoute || !candidateRoute) return false

    for (const error of snapshot.errors) {
      if (
        !this.getCandidateRouteIndexesForError(error, snapshot).includes(
          routeIndex,
        )
      ) {
        continue
      }
      const preloadedTraceId =
        this.b01Rerouter.getPreloadedTraceIdForDrcTraceId(
          typeof error.pcb_trace_id === "string"
            ? error.pcb_trace_id
            : getRawOtherTraceId(error),
        )
      if (!preloadedTraceId) continue
      const baselineOverlapCount =
        this.b01Rerouter.countRouteOverlapsWithPreloadedTrace(
          baselineRoute,
          preloadedTraceId,
        )
      const candidateOverlapCount =
        this.b01Rerouter.countRouteOverlapsWithPreloadedTrace(
          candidateRoute,
          preloadedTraceId,
        )
      if (candidateOverlapCount < baselineOverlapCount) return true
    }

    return false
  }

  private tryAnchoredFixedCopperCandidate(
    routes: HighDensityRoute[],
    snapshot: DrcSnapshot,
    routeIndex: number,
    centers: ReadonlyArray<{ x: number; y: number }>,
    options: {
      includeCandidateCopper: boolean
      reverse: boolean
    },
  ):
    | {
        routes: HighDensityRoute[]
        snapshot: DrcSnapshot
      }
    | undefined {
    const anchoredWindow = this.getAnchoredFixedCopperWindow(
      routes,
      routeIndex,
      centers,
    )
    if (!anchoredWindow) return undefined
    const iterationLimit = Math.min(
      MAX_ANCHORED_FIXED_COPPER_ITERATIONS_PER_ATTEMPT,
      this.getRemainingAnchoredFixedCopperIterations(),
    )
    if (
      iterationLimit <= 0 ||
      this.anchoredFixedCopperAttempts >= MAX_ANCHORED_FIXED_COPPER_ATTEMPTS ||
      this.anchoredFixedCopperDrcEvaluations >=
        MAX_ANCHORED_FIXED_COPPER_DRC_EVALUATIONS
    ) {
      return undefined
    }

    this.anchoredFixedCopperAttempts += 1
    const result = this.b01Rerouter.tryReroute(anchoredWindow.routes, {
      routeIndex,
      startIndex: anchoredWindow.startIndex,
      endIndex: anchoredWindow.endIndex,
      includeCandidateCopper: options.includeCandidateCopper,
      reverse: options.reverse,
      shortenPath: false,
      maxIterations: iterationLimit,
    })
    this.anchoredFixedCopperIterations += Math.min(
      iterationLimit,
      Math.max(0, result?.iterations ?? 0),
    )
    if (!result?.route || !routeHasValidLayerTransitions(result.route)) {
      return undefined
    }

    const candidateRoutes = cloneRoutes(anchoredWindow.routes)
    candidateRoutes[routeIndex] = result.route
    const materializedCandidate = materializeRoutes(candidateRoutes)
    if (
      materializedCandidate.some(
        (candidateRoute) => !routeHasValidLayerTransitions(candidateRoute),
      ) ||
      !this.candidatePreservesTerminals(materializedCandidate)
    ) {
      return undefined
    }

    this.anchoredFixedCopperDrcEvaluations += 1
    this.cleanupCandidateAttempts += 1
    const candidateSnapshot = this.getSnapshot(materializedCandidate)
    const snapshotImproved = this.snapshotImprovesWithoutFixedCopperRegression(
      candidateSnapshot,
      snapshot,
    )
    const fixedGeometryImproved =
      candidateSnapshot.count <= snapshot.count &&
      this.getFixedCopperIssueScore(candidateSnapshot) <=
        this.getFixedCopperIssueScore(snapshot) &&
      this.hasFixedTraceGeometryProgress(
        routes,
        materializedCandidate,
        snapshot,
        routeIndex,
      )
    if (!snapshotImproved && !fixedGeometryImproved) {
      return undefined
    }

    this.anchoredFixedCopperCandidatesAccepted += 1
    this.cleanupCandidatesAccepted += 1
    return {
      routes: materializedCandidate,
      snapshot: candidateSnapshot,
    }
  }

  private runAnchoredFixedCopperRepair(
    routes: HighDensityRoute[],
  ): HighDensityRoute[] {
    let improvedRoutes = routes
    let snapshot = this.getSnapshot(improvedRoutes)

    repairLoop: while (
      snapshot.count > 0 &&
      this.getRemainingAnchoredFixedCopperIterations() > 0 &&
      this.anchoredFixedCopperAttempts < MAX_ANCHORED_FIXED_COPPER_ATTEMPTS &&
      this.anchoredFixedCopperDrcEvaluations <
        MAX_ANCHORED_FIXED_COPPER_DRC_EVALUATIONS
    ) {
      const centersByRouteIndex = new Map<
        number,
        Array<{ x: number; y: number }>
      >()
      for (const error of snapshot.errors) {
        const center = this.getErrorCenter(error)
        for (const routeIndex of this.getCandidateRouteIndexesForError(
          error,
          snapshot,
        )) {
          const preloadedTraceId =
            this.b01Rerouter.getPreloadedTraceIdForDrcTraceId(
              typeof error.pcb_trace_id === "string"
                ? error.pcb_trace_id
                : getRawOtherTraceId(error),
            )
          const viaCenters =
            getErrorType(error) === "pcb_via_trace_clearance_error" &&
            preloadedTraceId &&
            improvedRoutes[routeIndex]
              ? this.b01Rerouter.getRouteViaCentersOverlappingPreloadedTrace(
                  improvedRoutes[routeIndex]!,
                  preloadedTraceId,
                )
              : []
          const repairCenters = [...viaCenters, ...(center ? [center] : [])]
          if (repairCenters.length === 0) continue
          const centers = centersByRouteIndex.get(routeIndex) ?? []
          for (const repairCenter of repairCenters) {
            if (
              !centers.some(
                (existingCenter) =>
                  getPointDistance(existingCenter, repairCenter) <=
                  POSITION_EPSILON,
              )
            ) {
              centers.push(repairCenter)
            }
          }
          centersByRouteIndex.set(routeIndex, centers)
        }
      }

      const routeGroups = [...centersByRouteIndex.entries()].toSorted(
        (left, right) => right[1].length - left[1].length || left[0] - right[0],
      )
      for (const [routeIndex, centers] of routeGroups) {
        const centerGroups =
          centers.length > 1
            ? [centers, ...centers.map((center) => [center])]
            : [centers]
        for (const centerGroup of centerGroups) {
          for (const includeCandidateCopper of [true, false]) {
            for (const reverse of [false, true]) {
              const candidate = this.tryAnchoredFixedCopperCandidate(
                improvedRoutes,
                snapshot,
                routeIndex,
                centerGroup,
                { includeCandidateCopper, reverse },
              )
              if (!candidate) {
                if (
                  this.getRemainingAnchoredFixedCopperIterations() <= 0 ||
                  this.anchoredFixedCopperAttempts >=
                    MAX_ANCHORED_FIXED_COPPER_ATTEMPTS ||
                  this.anchoredFixedCopperDrcEvaluations >=
                    MAX_ANCHORED_FIXED_COPPER_DRC_EVALUATIONS
                ) {
                  break repairLoop
                }
                continue
              }
              improvedRoutes = candidate.routes
              snapshot = candidate.snapshot
              continue repairLoop
            }
          }
        }
      }
      break
    }

    return improvedRoutes
  }

  private getDrcErrorIdentity(error: DrcError): string {
    for (const idKey of [
      "pcb_trace_error_id",
      "pcb_via_trace_clearance_error_id",
      "pcb_pad_trace_clearance_error_id",
      "pcb_via_clearance_error_id",
      "pcb_error_id",
    ]) {
      const id = error[idKey]
      if (typeof id === "string") return `${getErrorType(error)}:${id}`
    }

    const center = this.getErrorCenter(error)
    return JSON.stringify([
      getErrorType(error),
      error.pcb_trace_id,
      error.pcb_via_id,
      getCandidateTraceIdsFromError(error).toSorted(),
      center?.x,
      center?.y,
      error.message,
    ])
  }

  private getFixedCopperCompositePlans(
    snapshot: DrcSnapshot,
  ): FixedCopperCompositePlan[] {
    if (
      snapshot.count === 0 ||
      snapshot.count > MAX_FIXED_COPPER_COMPOSITE_RESIDUAL
    ) {
      return []
    }

    const plans: FixedCopperCompositePlan[] = []
    const seenRouteIndexes = new Set<number>()
    for (const error of snapshot.errors) {
      if (
        getErrorType(error) !== "pcb_trace_error" ||
        typeof error.pcb_trace_error_id !== "string" ||
        !error.pcb_trace_error_id.startsWith("overlap_")
      ) {
        continue
      }

      const referencedTraceIds = [
        typeof error.pcb_trace_id === "string" ? error.pcb_trace_id : undefined,
        getRawOtherTraceId(error),
      ].filter((traceId): traceId is string => Boolean(traceId))
      const referencesFixedCopper = referencedTraceIds.some(
        (traceId) => !snapshot.traceRouteIndexById.has(traceId),
      )
      const candidateRouteIndexes = this.getCandidateRouteIndexesForError(
        error,
        snapshot,
      )
      if (
        !referencesFixedCopper ||
        candidateRouteIndexes.length !== 1 ||
        seenRouteIndexes.has(candidateRouteIndexes[0]!)
      ) {
        continue
      }

      const routeIndex = candidateRouteIndexes[0]!
      seenRouteIndexes.add(routeIndex)
      plans.push({
        routeIndex,
        targetErrorIdentity: this.getDrcErrorIdentity(error),
      })
    }

    return plans
  }

  private getRemainingFixedCopperCompositeIterations(): number {
    return Math.max(
      0,
      MAX_FIXED_COPPER_COMPOSITE_ITERATIONS -
        this.fixedCopperCompositeIterations,
    )
  }

  private evaluateFixedCopperCompositeCandidate(
    routes: HighDensityRoute[],
  ): DrcSnapshot | undefined {
    if (
      this.fixedCopperCompositeDrcEvaluations >=
      MAX_FIXED_COPPER_COMPOSITE_DRC_EVALUATIONS
    ) {
      return undefined
    }
    this.fixedCopperCompositeDrcEvaluations += 1
    this.cleanupCandidateAttempts += 1
    return this.getSnapshot(routes)
  }

  private getNewlyExposedFixedCopperCompositeOwners(
    snapshot: DrcSnapshot,
    baselineErrorIdentities: ReadonlySet<string>,
    primaryRouteIndex: number,
  ): number[] {
    const degreeByRouteIndex = new Map<number, number>()
    for (const error of snapshot.errors) {
      if (baselineErrorIdentities.has(this.getDrcErrorIdentity(error))) {
        continue
      }
      for (const routeIndex of this.getCandidateRouteIndexesForError(
        error,
        snapshot,
      )) {
        if (routeIndex === primaryRouteIndex) continue
        degreeByRouteIndex.set(
          routeIndex,
          (degreeByRouteIndex.get(routeIndex) ?? 0) + 1,
        )
      }
    }

    return [...degreeByRouteIndex.keys()]
      .toSorted(
        (left, right) =>
          (degreeByRouteIndex.get(right) ?? 0) -
            (degreeByRouteIndex.get(left) ?? 0) || left - right,
      )
      .slice(0, MAX_FIXED_COPPER_COMPOSITE_FOLLOWUP_OWNERS)
  }

  private acceptFixedCopperCompositeCandidate(
    routes: HighDensityRoute[],
    snapshot: DrcSnapshot,
  ): { routes: HighDensityRoute[]; snapshot: DrcSnapshot } {
    this.fixedCopperCompositeCandidatesAccepted += 1
    this.cleanupCandidatesAccepted += 1
    return { routes, snapshot }
  }

  private tryFixedCopperCompositePlan(
    routes: HighDensityRoute[],
    baselineSnapshot: DrcSnapshot,
    plan: FixedCopperCompositePlan,
  ):
    | {
        routes: HighDensityRoute[]
        snapshot: DrcSnapshot
      }
    | undefined {
    const baselineErrorIdentities = new Set(
      baselineSnapshot.errors.map((error) => this.getDrcErrorIdentity(error)),
    )

    for (const primaryVariant of FIXED_COPPER_COMPOSITE_PRIMARY_VARIANTS) {
      const primaryIterationLimit = Math.min(
        MAX_FIXED_COPPER_COMPOSITE_ITERATIONS_PER_ATTEMPT,
        this.getRemainingFixedCopperCompositeIterations(),
      )
      if (
        primaryIterationLimit <= 0 ||
        this.fixedCopperCompositePrimaryAttempts >=
          MAX_FIXED_COPPER_COMPOSITE_PRIMARY_ATTEMPTS ||
        this.fixedCopperCompositeDrcEvaluations >=
          MAX_FIXED_COPPER_COMPOSITE_DRC_EVALUATIONS
      ) {
        return undefined
      }

      this.fixedCopperCompositePrimaryAttempts += 1
      const primaryResult = this.b01Rerouter.tryReroute(routes, {
        routeIndex: plan.routeIndex,
        includeCandidateCopper: false,
        ...primaryVariant,
        maxIterations: primaryIterationLimit,
      })
      this.fixedCopperCompositeIterations += Math.min(
        primaryIterationLimit,
        Math.max(0, primaryResult?.iterations ?? 0),
      )
      if (
        !primaryResult?.route ||
        !routeHasValidLayerTransitions(primaryResult.route)
      ) {
        continue
      }

      const primaryRoutes = cloneRoutes(routes)
      primaryRoutes[plan.routeIndex] = primaryResult.route
      const materializedPrimary = materializeRoutes(primaryRoutes)
      if (
        materializedPrimary.some(
          (route) => !routeHasValidLayerTransitions(route),
        ) ||
        !this.candidatePreservesTerminals(materializedPrimary)
      ) {
        continue
      }

      const primarySnapshot =
        this.evaluateFixedCopperCompositeCandidate(materializedPrimary)
      if (!primarySnapshot) return undefined
      if (
        this.snapshotImprovesWithoutFixedCopperRegression(
          primarySnapshot,
          baselineSnapshot,
        )
      ) {
        return this.acceptFixedCopperCompositeCandidate(
          materializedPrimary,
          primarySnapshot,
        )
      }
      if (
        primarySnapshot.count > MAX_FIXED_COPPER_COMPOSITE_EXPOSED_ISSUES ||
        primarySnapshot.errors.some(
          (error) =>
            this.getDrcErrorIdentity(error) === plan.targetErrorIdentity,
        )
      ) {
        continue
      }

      let workingRoutes = materializedPrimary
      let workingSnapshot = primarySnapshot
      const exposedOwnerRouteIndexes =
        this.getNewlyExposedFixedCopperCompositeOwners(
          workingSnapshot,
          baselineErrorIdentities,
          plan.routeIndex,
        )
      if (exposedOwnerRouteIndexes.length === 0) continue

      for (const ownerRouteIndex of exposedOwnerRouteIndexes) {
        let bestOwnerCandidate:
          | {
              routes: HighDensityRoute[]
              snapshot: DrcSnapshot
            }
          | undefined

        for (const followupVariant of FINAL_OWNER_FULL_VARIANTS) {
          const followupIterationLimit = Math.min(
            MAX_FIXED_COPPER_COMPOSITE_ITERATIONS_PER_ATTEMPT,
            this.getRemainingFixedCopperCompositeIterations(),
          )
          if (
            followupIterationLimit <= 0 ||
            this.fixedCopperCompositeFollowupAttempts >=
              MAX_FIXED_COPPER_COMPOSITE_FOLLOWUP_ATTEMPTS ||
            this.fixedCopperCompositeDrcEvaluations >=
              MAX_FIXED_COPPER_COMPOSITE_DRC_EVALUATIONS
          ) {
            break
          }

          this.fixedCopperCompositeFollowupAttempts += 1
          const followupResult = this.b01Rerouter.tryReroute(workingRoutes, {
            routeIndex: ownerRouteIndex,
            includeCandidateCopper: true,
            ...followupVariant,
            maxIterations: followupIterationLimit,
          })
          this.fixedCopperCompositeIterations += Math.min(
            followupIterationLimit,
            Math.max(0, followupResult?.iterations ?? 0),
          )
          if (
            !followupResult?.route ||
            !routeHasValidLayerTransitions(followupResult.route)
          ) {
            continue
          }

          const followupRoutes = cloneRoutes(workingRoutes)
          followupRoutes[ownerRouteIndex] = followupResult.route
          const materializedFollowup = materializeRoutes(followupRoutes)
          if (
            materializedFollowup.some(
              (route) => !routeHasValidLayerTransitions(route),
            ) ||
            !this.candidatePreservesTerminals(materializedFollowup)
          ) {
            continue
          }

          const followupSnapshot =
            this.evaluateFixedCopperCompositeCandidate(materializedFollowup)
          if (!followupSnapshot) break
          if (
            this.snapshotImprovesWithoutFixedCopperRegression(
              followupSnapshot,
              baselineSnapshot,
            )
          ) {
            return this.acceptFixedCopperCompositeCandidate(
              materializedFollowup,
              followupSnapshot,
            )
          }
          if (
            followupSnapshot.count < workingSnapshot.count &&
            (!bestOwnerCandidate ||
              followupSnapshot.count < bestOwnerCandidate.snapshot.count)
          ) {
            bestOwnerCandidate = {
              routes: materializedFollowup,
              snapshot: followupSnapshot,
            }
          }
        }

        if (!bestOwnerCandidate) continue
        workingRoutes = bestOwnerCandidate.routes
        workingSnapshot = bestOwnerCandidate.snapshot
      }

      if (
        this.snapshotImprovesWithoutFixedCopperRegression(
          workingSnapshot,
          baselineSnapshot,
        )
      ) {
        return this.acceptFixedCopperCompositeCandidate(
          workingRoutes,
          workingSnapshot,
        )
      }
    }

    return undefined
  }

  private runFixedCopperCompositeRepair(
    routes: HighDensityRoute[],
  ): HighDensityRoute[] {
    let improvedRoutes = routes
    let snapshot = this.getSnapshot(improvedRoutes)

    while (
      snapshot.count > 0 &&
      snapshot.count <= MAX_FIXED_COPPER_COMPOSITE_RESIDUAL &&
      this.getRemainingFixedCopperCompositeIterations() > 0 &&
      this.fixedCopperCompositePrimaryAttempts <
        MAX_FIXED_COPPER_COMPOSITE_PRIMARY_ATTEMPTS &&
      this.fixedCopperCompositeDrcEvaluations <
        MAX_FIXED_COPPER_COMPOSITE_DRC_EVALUATIONS
    ) {
      let acceptedCandidate:
        | {
            routes: HighDensityRoute[]
            snapshot: DrcSnapshot
          }
        | undefined
      for (const plan of this.getFixedCopperCompositePlans(snapshot)) {
        acceptedCandidate = this.tryFixedCopperCompositePlan(
          improvedRoutes,
          snapshot,
          plan,
        )
        if (acceptedCandidate) break
      }
      if (!acceptedCandidate) break

      improvedRoutes = acceptedCandidate.routes
      snapshot = acceptedCandidate.snapshot
    }

    return improvedRoutes
  }

  private getAtomicEndpointSlideBranches(
    routes: HighDensityRoute[],
    routeIndex: number,
    endpoint: "start" | "end",
  ): EndpointSlideBranch[] {
    const anchorConstraint = this.terminalConstraints.find(
      (constraint) =>
        constraint.routeIndex === routeIndex &&
        constraint.endpoint === endpoint,
    )
    if (!anchorConstraint) return []

    const terminalPortId = anchorConstraint.originalPoint.pcb_port_id
    const constraints =
      typeof terminalPortId === "string"
        ? this.terminalConstraints.filter(
            (constraint) =>
              constraint.originalPoint.pcb_port_id === terminalPortId,
          )
        : [anchorConstraint]
    const branches: EndpointSlideBranch[] = []
    const seenBranches = new Set<string>()

    for (const constraint of constraints) {
      const branchKey = `${constraint.routeIndex}:${constraint.endpoint}`
      if (seenBranches.has(branchKey)) continue
      seenBranches.add(branchKey)
      const route = routes[constraint.routeIndex]
      if (!route) continue
      const endpointIndex =
        constraint.endpoint === "start" ? 0 : route.route.length - 1
      if (!route.route[endpointIndex]) continue
      branches.push({
        routeIndex: constraint.routeIndex,
        endpoint: constraint.endpoint,
        endpointIndex,
        coincidentIndexes: getCoincidentTerminalPointIndexes(
          route,
          endpointIndex,
        ),
        constraint,
      })
    }

    return branches
  }

  private tryFinalEndpointSlideCandidate(
    routes: HighDensityRoute[],
    snapshot: DrcSnapshot,
    error: DrcError,
  ):
    | {
        routes: HighDensityRoute[]
        snapshot: DrcSnapshot
      }
    | undefined {
    if (
      this.finalEndpointSlideDrcEvaluations >=
      MAX_FINAL_ENDPOINT_SLIDE_DRC_EVALUATIONS
    ) {
      return undefined
    }
    const errorType = getErrorType(error)
    const padId = getPhysicalPadIdFromError(error)
    if (
      !padId ||
      (errorType !== "pcb_pad_trace_clearance_error" &&
        errorType !== "pcb_trace_error")
    ) {
      return undefined
    }
    const foreignObstacle = this.originalObstacles.find((obstacle) =>
      obstacleRepresentsPhysicalPad(obstacle, padId),
    )
    if (!foreignObstacle) return undefined

    for (const routeIndex of this.getCandidateRouteIndexesForError(
      error,
      snapshot,
    )) {
      const route = routes[routeIndex]
      if (!route || route.route.length < 2) continue
      const endpoints = (["start", "end"] as const).toSorted((left, right) => {
        const leftPoint =
          left === "start" ? route.route[0]! : route.route.at(-1)!
        const rightPoint =
          right === "start" ? route.route[0]! : route.route.at(-1)!
        return (
          getPointDistance(leftPoint, foreignObstacle.center) -
          getPointDistance(rightPoint, foreignObstacle.center)
        )
      })

      for (const endpoint of endpoints) {
        const endpointPoint =
          endpoint === "start" ? route.route[0] : route.route.at(-1)
        if (!endpointPoint) continue
        const branches = this.getAtomicEndpointSlideBranches(
          routes,
          routeIndex,
          endpoint,
        )
        if (branches.length === 0) continue

        const preferredDirection = getUnitDirection(
          endpointPoint.x - foreignObstacle.center.x,
          endpointPoint.y - foreignObstacle.center.y,
        )
        for (const direction of getMicroShiftDirections(preferredDirection)) {
          for (const radius of ENDPOINT_SLIDE_RADII) {
            if (
              this.finalEndpointSlideDrcEvaluations >=
              MAX_FINAL_ENDPOINT_SLIDE_DRC_EVALUATIONS
            ) {
              return undefined
            }
            const candidatePoint = {
              x: endpointPoint.x + direction.x * radius,
              y: endpointPoint.y + direction.y * radius,
            }
            const everyBranchFitsOwningPad = branches.every((branch) => {
              const branchRoute = routes[branch.routeIndex]
              const branchEndpoint =
                branch.endpoint === "start"
                  ? branchRoute?.route[0]
                  : branchRoute?.route.at(-1)
              return Boolean(
                branchEndpoint &&
                  branch.constraint.owningObstacles.some(
                    (obstacle) =>
                      obstacleAppliesToLayer(
                        obstacle,
                        branchEndpoint.z,
                        this.params.srj.layerCount,
                      ) &&
                      pointFitsInsideObstacle(
                        candidatePoint,
                        obstacle,
                        branch.constraint.traceRadius,
                      ),
                  ),
              )
            })
            if (!everyBranchFitsOwningPad) continue

            const candidateRoutes = cloneRoutes(routes)
            for (const branch of branches) {
              const candidateRoute = candidateRoutes[branch.routeIndex]
              if (!candidateRoute) continue
              for (const pointIndex of branch.coincidentIndexes) {
                const point = candidateRoute.route[pointIndex]
                if (!point) continue
                point.x = candidatePoint.x
                point.y = candidatePoint.y
              }
            }
            const materializedCandidate = materializeRoutes(candidateRoutes)
            if (
              materializedCandidate.some(
                (candidateRoute) =>
                  !routeHasValidLayerTransitions(candidateRoute),
              ) ||
              !this.candidatePreservesTerminals(materializedCandidate)
            ) {
              continue
            }

            this.finalEndpointSlideAttempts += 1
            this.finalEndpointSlideDrcEvaluations += 1
            this.cleanupCandidateAttempts += 1
            const candidateSnapshot = this.getSnapshot(materializedCandidate)
            if (
              !this.snapshotImprovesWithoutFixedCopperRegression(
                candidateSnapshot,
                snapshot,
              )
            ) {
              continue
            }

            this.finalEndpointSlideCandidatesAccepted += 1
            this.finalEndpointSlideRelocatedBranches += branches.length
            this.cleanupCandidatesAccepted += 1
            return {
              routes: materializedCandidate,
              snapshot: candidateSnapshot,
            }
          }
        }
      }
    }

    return undefined
  }

  private runFinalEndpointSlideCleanup(
    routes: HighDensityRoute[],
  ): HighDensityRoute[] {
    let improvedRoutes = routes
    let snapshot = this.getSnapshot(improvedRoutes)

    while (
      snapshot.count > 0 &&
      this.finalEndpointSlideDrcEvaluations <
        MAX_FINAL_ENDPOINT_SLIDE_DRC_EVALUATIONS
    ) {
      let acceptedCandidate:
        | {
            routes: HighDensityRoute[]
            snapshot: DrcSnapshot
          }
        | undefined
      for (const error of snapshot.errors) {
        acceptedCandidate = this.tryFinalEndpointSlideCandidate(
          improvedRoutes,
          snapshot,
          error,
        )
        if (acceptedCandidate) break
        if (
          this.finalEndpointSlideDrcEvaluations >=
          MAX_FINAL_ENDPOINT_SLIDE_DRC_EVALUATIONS
        ) {
          break
        }
      }
      if (!acceptedCandidate) break
      improvedRoutes = acceptedCandidate.routes
      snapshot = acceptedCandidate.snapshot
    }

    return improvedRoutes
  }

  private tryInterpolatedFixedOverlapLayerBridge(
    routes: HighDensityRoute[],
    error: DrcError,
    maxIssueCountIncrease: number,
  ): HighDensityRoute[] | undefined {
    if (getErrorType(error) !== "pcb_trace_error") return undefined
    const center = this.getErrorCenter(error)
    if (!center) return undefined
    const snapshot = this.getSnapshot(routes)
    const routeIndex = this.getCandidateRouteIndexesForError(error, snapshot)[0]
    const route = routeIndex === undefined ? undefined : routes[routeIndex]
    if (!route || route.route.length < 2) return undefined

    const cumulativeDistances = [0]
    for (let index = 0; index < route.route.length - 1; index += 1) {
      cumulativeDistances.push(
        cumulativeDistances[index]! +
          getPointDistance(route.route[index]!, route.route[index + 1]!),
      )
    }
    let nearestSegmentIndex = -1
    let nearestProjection = 0
    let nearestDistance = Number.POSITIVE_INFINITY
    for (
      let segmentIndex = 0;
      segmentIndex < route.route.length - 1;
      segmentIndex += 1
    ) {
      const start = route.route[segmentIndex]!
      const end = route.route[segmentIndex + 1]!
      if (start.z !== end.z) continue
      const segmentLength = getPointDistance(start, end)
      if (segmentLength <= POSITION_EPSILON) continue
      const distance = getPointToSegmentDistance(center, start, end)
      if (distance >= nearestDistance) continue
      const deltaX = end.x - start.x
      const deltaY = end.y - start.y
      nearestDistance = distance
      nearestSegmentIndex = segmentIndex
      nearestProjection = Math.max(
        0,
        Math.min(
          1,
          ((center.x - start.x) * deltaX + (center.y - start.y) * deltaY) /
            (segmentLength * segmentLength),
        ),
      )
    }
    if (nearestSegmentIndex < 0) return undefined

    const sourceZ = route.route[nearestSegmentIndex]!.z
    let sameLayerStart = nearestSegmentIndex
    let sameLayerEnd = nearestSegmentIndex + 1
    while (
      sameLayerStart > 0 &&
      route.route[sameLayerStart - 1]!.z === sourceZ
    ) {
      sameLayerStart -= 1
    }
    while (
      sameLayerEnd < route.route.length - 1 &&
      route.route[sameLayerEnd + 1]!.z === sourceZ
    ) {
      sameLayerEnd += 1
    }
    const projectedRouteDistance =
      cumulativeDistances[nearestSegmentIndex]! +
      nearestProjection *
        getPointDistance(
          route.route[nearestSegmentIndex]!,
          route.route[nearestSegmentIndex + 1]!,
        )

    const getAnchor = (
      routeDistance: number,
    ):
      | {
          segmentIndex: number
          point: HighDensityRoute["route"][number]
        }
      | undefined => {
      for (
        let segmentIndex = sameLayerStart;
        segmentIndex < sameLayerEnd;
        segmentIndex += 1
      ) {
        const startDistance = cumulativeDistances[segmentIndex]!
        const endDistance = cumulativeDistances[segmentIndex + 1]!
        if (routeDistance > endDistance + POSITION_EPSILON) continue
        const segmentLength = endDistance - startDistance
        if (segmentLength <= POSITION_EPSILON) continue
        const start = route.route[segmentIndex]!
        const end = route.route[segmentIndex + 1]!
        const fraction = Math.max(
          0,
          Math.min(1, (routeDistance - startDistance) / segmentLength),
        )
        return {
          segmentIndex,
          point: {
            x: start.x + (end.x - start.x) * fraction,
            y: start.y + (end.y - start.y) * fraction,
            z: sourceZ,
            traceThickness: route.traceThickness,
          },
        }
      }
      return undefined
    }

    const targetErrorIdentity = this.getDrcErrorIdentity(error)
    const baselineFixedScore = this.getFixedCopperIssueScore(snapshot)
    const fixedTraceId = this.b01Rerouter.getPreloadedTraceIdForDrcTraceId(
      typeof error.pcb_trace_id === "string"
        ? error.pcb_trace_id
        : getRawOtherTraceId(error),
    )
    const baselineTargetOverlapCount = fixedTraceId
      ? this.b01Rerouter.countRouteOverlapsWithPreloadedTrace(
          route,
          fixedTraceId,
        )
      : 0
    let bestCandidate:
      | { routes: HighDensityRoute[]; snapshot: DrcSnapshot }
      | undefined
    for (const halfSpan of [0.35, 0.5, 0.75, 1, 1.5, 2, 3, 5, 8, 12, 20, 40]) {
      const startDistance = Math.max(
        cumulativeDistances[sameLayerStart]!,
        projectedRouteDistance - halfSpan,
      )
      const endDistance = Math.min(
        cumulativeDistances[sameLayerEnd]!,
        projectedRouteDistance + halfSpan,
      )
      const startAnchor = getAnchor(startDistance)
      const endAnchor = getAnchor(endDistance)
      if (
        !startAnchor ||
        !endAnchor ||
        startAnchor.segmentIndex > endAnchor.segmentIndex
      ) {
        continue
      }
      for (
        let targetZ = 0;
        targetZ < this.params.srj.layerCount;
        targetZ += 1
      ) {
        if (targetZ === sourceZ || !this.hasLocalCleanupBudget()) continue
        const bridgeRoute = [
          ...route.route.slice(0, startAnchor.segmentIndex + 1),
          { ...startAnchor.point },
          {
            ...startAnchor.point,
            z: targetZ,
            pcb_port_id: undefined,
          },
          {
            ...endAnchor.point,
            z: targetZ,
            pcb_port_id: undefined,
          },
          { ...endAnchor.point },
          ...route.route.slice(endAnchor.segmentIndex + 1),
        ]
        const candidateRoutes = cloneRoutes(routes)
        candidateRoutes[routeIndex] = { ...route, route: bridgeRoute }
        const materializedCandidate = materializeRoutes(candidateRoutes)
        if (
          !routeHasValidLayerTransitions(materializedCandidate[routeIndex]!) ||
          !this.candidatePreservesTerminals(materializedCandidate)
        ) {
          continue
        }

        this.cleanupCandidateAttempts += 1
        this.localCleanupDrcEvaluations += 1
        const candidateSnapshot = this.getSnapshot(materializedCandidate)
        const candidateFixedScore =
          this.getFixedCopperIssueScore(candidateSnapshot)
        const targetWasRemoved = !candidateSnapshot.errors.some(
          (candidateError) =>
            this.getDrcErrorIdentity(candidateError) === targetErrorIdentity,
        )
        const targetOverlapCount = fixedTraceId
          ? this.b01Rerouter.countRouteOverlapsWithPreloadedTrace(
              materializedCandidate[routeIndex]!,
              fixedTraceId,
            )
          : baselineTargetOverlapCount
        const targetGeometryImproved =
          fixedTraceId !== undefined &&
          targetOverlapCount < baselineTargetOverlapCount
        if (
          (!targetWasRemoved && !targetGeometryImproved) ||
          candidateFixedScore > baselineFixedScore ||
          candidateSnapshot.count > snapshot.count + maxIssueCountIncrease
        ) {
          continue
        }
        if (
          !bestCandidate ||
          candidateFixedScore <
            this.getFixedCopperIssueScore(bestCandidate.snapshot) ||
          (candidateFixedScore ===
            this.getFixedCopperIssueScore(bestCandidate.snapshot) &&
            candidateSnapshot.count < bestCandidate.snapshot.count)
        ) {
          bestCandidate = {
            routes: materializedCandidate,
            snapshot: candidateSnapshot,
          }
        }
      }
    }

    if (!bestCandidate) return undefined
    this.cleanupCandidatesAccepted += 1
    this.consecutiveLocalCleanupDrcMisses = 0
    return bestCandidate.routes
  }

  private runFinalFixedOverlapLayerDetour(
    routes: HighDensityRoute[],
    options: {
      drcEvaluationLimit?: number
      maxIssueCountIncrease?: number
    } = {},
  ): HighDensityRoute[] {
    let improvedRoutes = routes
    const drcEvaluationLimit =
      options.drcEvaluationLimit ??
      MAX_FINAL_FIXED_OVERLAP_LAYER_DETOUR_DRC_EVALUATIONS
    const baseEvaluationLimit = this.selectedLocalCleanupDrcEvaluationLimit
    const baseConsecutiveMissLimit =
      this.selectedConsecutiveLocalCleanupDrcMissLimit
    const evaluationsBeforeSweep = this.localCleanupDrcEvaluations
    this.selectedLocalCleanupDrcEvaluationLimit =
      evaluationsBeforeSweep + drcEvaluationLimit
    this.selectedConsecutiveLocalCleanupDrcMissLimit = drcEvaluationLimit
    this.consecutiveLocalCleanupDrcMisses = 0

    try {
      while (
        this.localCleanupDrcEvaluations - evaluationsBeforeSweep <
          drcEvaluationLimit &&
        this.hasLocalCleanupBudget()
      ) {
        const snapshot = this.getSnapshot(improvedRoutes)
        if (snapshot.count === 0) break
        let nextRoutes: HighDensityRoute[] | undefined

        for (const error of snapshot.errors) {
          if (getErrorType(error) !== "pcb_trace_error") continue
          const primaryTraceId =
            typeof error.pcb_trace_id === "string"
              ? error.pcb_trace_id
              : undefined
          const otherTraceId = getRawOtherTraceId(error)
          const primaryIsCandidate = Boolean(
            primaryTraceId && snapshot.traceRouteIndexById.has(primaryTraceId),
          )
          const otherIsCandidate = Boolean(
            otherTraceId && snapshot.traceRouteIndexById.has(otherTraceId),
          )
          if (primaryIsCandidate === otherIsCandidate) continue

          nextRoutes = this.tryInterpolatedFixedOverlapLayerBridge(
            improvedRoutes,
            error,
            options.maxIssueCountIncrease ?? 2,
          )
          nextRoutes ??= this.tryLocalTraceLayerDetour(improvedRoutes, error, {
            preferFixedCopperIssueReduction: true,
            maxIssueCountIncrease: options.maxIssueCountIncrease,
          })
          if (nextRoutes) break
          if (!this.hasLocalCleanupBudget()) break
        }

        if (!nextRoutes) break
        this.finalFixedOverlapLayerDetourCandidatesAccepted += 1
        improvedRoutes = nextRoutes
      }
    } finally {
      this.finalFixedOverlapLayerDetourDrcEvaluations +=
        this.localCleanupDrcEvaluations - evaluationsBeforeSweep
      this.selectedLocalCleanupDrcEvaluationLimit = baseEvaluationLimit
      this.selectedConsecutiveLocalCleanupDrcMissLimit =
        baseConsecutiveMissLimit
    }

    return improvedRoutes
  }

  private getCombinedMissingConnectionCanonicalNet(
    error: DrcError,
  ): string | undefined {
    if (
      getErrorType(error) !== "pcb_trace_error" ||
      typeof error.pcb_trace_error_id !== "string" ||
      !error.pcb_trace_error_id.startsWith("missing_connection_combined_") ||
      typeof error.source_trace_id !== "string"
    ) {
      return undefined
    }
    return (
      this.params.connMap?.getNetConnectedToId(error.source_trace_id) ??
      error.source_trace_id
    )
  }

  private getPreloadedCopperLayersAtPoint(
    canonicalNet: string,
    point: { x: number; y: number },
  ): number[] {
    const zLayers = new Set<number>()
    const addLayer = (layer: string) => {
      const z = mapLayerNameToZ(layer, this.params.srj.layerCount)
      if (Number.isInteger(z) && z >= 0 && z < this.params.srj.layerCount) {
        zLayers.add(z)
      }
    }
    for (const trace of this.params.srj.traces ?? []) {
      const traceCanonicalNet =
        this.params.connMap?.getNetConnectedToId(trace.connection_name) ??
        trace.connection_name
      if (traceCanonicalNet !== canonicalNet) continue

      for (
        let pointIndex = 0;
        pointIndex < trace.route.length;
        pointIndex += 1
      ) {
        const routePoint = trace.route[pointIndex]!
        const nextPoint = trace.route[pointIndex + 1]
        if (routePoint.route_type === "wire") {
          if (
            getPointDistance(point, routePoint) <=
            PRELOADED_TERMINAL_MATCH_TOLERANCE
          ) {
            addLayer(routePoint.layer)
          }
          if (
            nextPoint?.route_type === "wire" &&
            nextPoint.layer === routePoint.layer &&
            getPointToSegmentDistance(point, routePoint, nextPoint) <=
              PRELOADED_TERMINAL_MATCH_TOLERANCE
          ) {
            addLayer(routePoint.layer)
          }
        }
      }
    }

    return [...zLayers].sort((left, right) => left - right)
  }

  private routeAlreadyHasTransitionAtPoint(
    route: HighDensityRoute,
    point: { x: number; y: number },
  ): boolean {
    if (
      route.vias.some(
        (via) =>
          getPointDistance(via, point) <= PRELOADED_TERMINAL_MATCH_TOLERANCE,
      )
    ) {
      return true
    }
    return route.route.some((routePoint, pointIndex) => {
      const nextPoint = route.route[pointIndex + 1]
      return Boolean(
        nextPoint &&
          routePoint.z !== nextPoint.z &&
          getPointDistance(routePoint, nextPoint) <= POSITION_EPSILON &&
          getPointDistance(routePoint, point) <=
            PRELOADED_TERMINAL_MATCH_TOLERANCE,
      )
    })
  }

  private getFinalContinuityTerminalViaCandidates(
    routes: HighDensityRoute[],
    snapshot: DrcSnapshot,
    error: DrcError,
  ): FinalContinuityTerminalViaCandidate[] {
    const canonicalNet = this.getCombinedMissingConnectionCanonicalNet(error)
    if (!canonicalNet) return []
    const errorCenter = this.getErrorCenter(error)
    const candidates: FinalContinuityTerminalViaCandidate[] = []

    for (const routeIndex of this.getCandidateRouteIndexesForError(
      error,
      snapshot,
    )) {
      const route = routes[routeIndex]
      const routeCanonicalNet =
        (route && this.getCanonicalNetForRoute(route)) ??
        route?.rootConnectionName ??
        route?.connectionName
      if (!route || routeCanonicalNet !== canonicalNet) continue

      for (const endpoint of ["start", "end"] as const) {
        const constraint = this.terminalConstraints.find(
          (candidateConstraint) =>
            candidateConstraint.routeIndex === routeIndex &&
            candidateConstraint.endpoint === endpoint &&
            typeof candidateConstraint.originalPoint.pcb_port_id === "string",
        )
        const terminal =
          endpoint === "start" ? route.route[0] : route.route.at(-1)
        if (
          !constraint ||
          !terminal ||
          terminal.z !== constraint.originalPoint.z ||
          this.routeAlreadyHasTransitionAtPoint(route, terminal) ||
          !this.terminalCanHostRelocatedVia(routes, routeIndex, endpoint)
        ) {
          continue
        }

        for (const targetZ of this.getPreloadedCopperLayersAtPoint(
          canonicalNet,
          terminal,
        )) {
          if (targetZ === terminal.z) continue
          candidates.push({
            routeIndex,
            endpoint,
            targetZ,
            distanceToError: errorCenter
              ? getPointDistance(terminal, errorCenter)
              : 0,
          })
        }
      }
    }

    return candidates.sort(
      (left, right) =>
        left.distanceToError - right.distanceToError ||
        left.routeIndex - right.routeIndex ||
        (left.endpoint === right.endpoint
          ? Math.abs(left.targetZ) - Math.abs(right.targetZ)
          : left.endpoint === "start"
            ? -1
            : 1),
    )
  }

  private addFinalContinuityTerminalViaStub(
    route: HighDensityRoute,
    endpoint: "start" | "end",
    targetZ: number,
  ): HighDensityRoute | undefined {
    const terminal = endpoint === "start" ? route.route[0] : route.route.at(-1)
    if (
      !terminal ||
      targetZ === terminal.z ||
      targetZ < 0 ||
      targetZ >= this.params.srj.layerCount ||
      this.routeAlreadyHasTransitionAtPoint(route, terminal)
    ) {
      return undefined
    }

    const { pcb_port_id: _pcbPortId, ...terminalWithoutIdentity } = terminal
    const targetLayerPoint = {
      ...terminalWithoutIdentity,
      z: targetZ,
    }
    const routePoints =
      endpoint === "start"
        ? [
            { ...terminal },
            targetLayerPoint,
            { ...terminalWithoutIdentity },
            ...route.route.slice(1),
          ]
        : [
            ...route.route.slice(0, -1),
            { ...terminalWithoutIdentity },
            targetLayerPoint,
            { ...terminal },
          ]
    const materializedRoute = materializeRoutes([
      { ...route, route: routePoints },
    ])[0]
    if (
      !materializedRoute ||
      !routeHasValidLayerTransitions(materializedRoute)
    ) {
      return undefined
    }

    const transitionCountAtTerminal = materializedRoute.route.filter(
      (routePoint, pointIndex) => {
        const nextPoint = materializedRoute.route[pointIndex + 1]
        return Boolean(
          nextPoint &&
            routePoint.z !== nextPoint.z &&
            getPointDistance(routePoint, nextPoint) <= POSITION_EPSILON &&
            getPointDistance(routePoint, terminal) <= POSITION_EPSILON,
        )
      },
    ).length
    const viaCountAtTerminal = materializedRoute.vias.filter(
      (via) =>
        getPointDistance(via, terminal) <= PRELOADED_TERMINAL_MATCH_TOLERANCE,
    ).length
    if (transitionCountAtTerminal !== 2 || viaCountAtTerminal !== 1) {
      return undefined
    }
    return materializedRoute
  }

  private runFinalContinuityTerminalViaBridge(
    routes: HighDensityRoute[],
  ): HighDensityRoute[] {
    let improvedRoutes = routes
    let snapshot = this.getSnapshot(improvedRoutes)

    while (
      snapshot.count > 0 &&
      this.finalContinuityTerminalViaAttempts <
        MAX_FINAL_CONTINUITY_TERMINAL_VIA_ATTEMPTS &&
      this.finalContinuityTerminalViaDrcEvaluations <
        MAX_FINAL_CONTINUITY_TERMINAL_VIA_DRC_EVALUATIONS
    ) {
      let acceptedCandidate:
        | {
            routes: HighDensityRoute[]
            snapshot: DrcSnapshot
          }
        | undefined

      errorLoop: for (const error of snapshot.errors) {
        for (const candidate of this.getFinalContinuityTerminalViaCandidates(
          improvedRoutes,
          snapshot,
          error,
        )) {
          if (
            this.finalContinuityTerminalViaAttempts >=
              MAX_FINAL_CONTINUITY_TERMINAL_VIA_ATTEMPTS ||
            this.finalContinuityTerminalViaDrcEvaluations >=
              MAX_FINAL_CONTINUITY_TERMINAL_VIA_DRC_EVALUATIONS
          ) {
            break errorLoop
          }
          this.finalContinuityTerminalViaAttempts += 1

          const candidateRoutes = cloneRoutes(improvedRoutes)
          const bridgedRoute = this.addFinalContinuityTerminalViaStub(
            candidateRoutes[candidate.routeIndex]!,
            candidate.endpoint,
            candidate.targetZ,
          )
          if (!bridgedRoute) continue
          candidateRoutes[candidate.routeIndex] = bridgedRoute
          const materializedCandidate = materializeRoutes(candidateRoutes)
          if (
            materializedCandidate.some(
              (candidateRoute) =>
                !routeHasValidLayerTransitions(candidateRoute),
            ) ||
            !this.candidatePreservesTerminals(materializedCandidate)
          ) {
            continue
          }

          this.finalContinuityTerminalViaDrcEvaluations += 1
          this.cleanupCandidateAttempts += 1
          const candidateSnapshot = this.getSnapshot(materializedCandidate)
          if (
            !this.snapshotImprovesWithoutFixedCopperRegression(
              candidateSnapshot,
              snapshot,
            )
          ) {
            continue
          }

          this.finalContinuityTerminalViaCandidatesAccepted += 1
          this.cleanupCandidatesAccepted += 1
          acceptedCandidate = {
            routes: materializedCandidate,
            snapshot: candidateSnapshot,
          }
          break errorLoop
        }
      }

      if (!acceptedCandidate) break
      improvedRoutes = acceptedCandidate.routes
      snapshot = acceptedCandidate.snapshot
    }

    return improvedRoutes
  }

  private runPipeline9Cleanup(routes: HighDensityRoute[]): HighDensityRoute[] {
    this.selectAdaptiveCleanupLimits()
    let improvedRoutes = this.normalizeViaMetadataFromLayerTransitions(
      this.unlockCleanupTerminals(routes),
    )
    improvedRoutes = this.runViaMicroShiftCleanup(improvedRoutes)

    for (let pass = 0; pass < MAX_CLEANUP_PASSES; pass += 1) {
      const snapshot = this.getSnapshot(improvedRoutes)
      if (snapshot.count === 0) break

      let nextRoutes: HighDensityRoute[] | undefined
      for (const error of snapshot.errors) {
        if (!this.hasLocalCleanupBudget()) break
        nextRoutes = this.tryEndpointSlide(improvedRoutes, error)
        if (nextRoutes) break
      }
      if (!nextRoutes) {
        for (const error of snapshot.errors) {
          if (!this.hasLocalCleanupBudget()) break
          nextRoutes = this.tryLocalTraceLayerDetour(improvedRoutes, error)
          if (nextRoutes) break
        }
      }
      if (!nextRoutes) {
        for (const error of snapshot.errors) {
          if (!this.hasLocalCleanupBudget()) break
          nextRoutes = this.tryBatchedTraceForce(improvedRoutes, error)
          if (nextRoutes) break
        }
      }
      if (!nextRoutes) break
      improvedRoutes = nextRoutes
    }
    improvedRoutes = this.runViaMicroShiftCleanup(improvedRoutes)
    improvedRoutes = this.runFinalFixedOverlapLayerDetour(improvedRoutes, {
      drcEvaluationLimit: MAX_EARLY_FIXED_OVERLAP_LAYER_DETOUR_DRC_EVALUATIONS,
      maxIssueCountIncrease: 2,
    })
    improvedRoutes = this.runPostClusterViaMicroShiftCleanup(improvedRoutes)

    for (let round = 0; round < MAX_B01_PHASE_ROUNDS; round += 1) {
      const issueCountBeforeRound = this.getSnapshot(improvedRoutes).count
      if (issueCountBeforeRound === 0) break

      let issueCountBeforePhase = issueCountBeforeRound
      improvedRoutes = this.runB01FullRouteCleanup(improvedRoutes)
      let issueCountAfterPhase = this.getSnapshot(improvedRoutes).count
      if (issueCountAfterPhase < issueCountBeforePhase) {
        improvedRoutes = this.runViaMicroShiftCleanup(improvedRoutes)
      }

      issueCountBeforePhase = this.getSnapshot(improvedRoutes).count
      improvedRoutes = this.runB01InteriorCleanup(improvedRoutes)
      issueCountAfterPhase = this.getSnapshot(improvedRoutes).count
      if (issueCountAfterPhase < issueCountBeforePhase) {
        improvedRoutes = this.runViaMicroShiftCleanup(improvedRoutes)
      }

      issueCountBeforePhase = this.getSnapshot(improvedRoutes).count
      improvedRoutes = this.runB01FixedOnlyCleanup(improvedRoutes)
      issueCountAfterPhase = this.getSnapshot(improvedRoutes).count
      if (issueCountAfterPhase < issueCountBeforePhase) {
        improvedRoutes = this.runViaMicroShiftCleanup(improvedRoutes)
      }

      if (this.getSnapshot(improvedRoutes).count >= issueCountBeforeRound) {
        break
      }
    }

    improvedRoutes = this.runB01ErrorOwnedClusterRebuildPasses(improvedRoutes)
    improvedRoutes = this.runPostClusterViaMicroShiftCleanup(improvedRoutes)
    improvedRoutes = this.runB01FinalErrorOwnerSweep(improvedRoutes)
    improvedRoutes = this.runPostRepairSameNetViaMerge(improvedRoutes)
    improvedRoutes = this.runSharedTerminalCompositeRepair(improvedRoutes)
    improvedRoutes = this.runPostFinalCompositeRepair(improvedRoutes)
    improvedRoutes = this.runAnchoredFixedCopperRepair(improvedRoutes)
    improvedRoutes = this.runFixedCopperCompositeRepair(improvedRoutes)
    improvedRoutes = this.runFinalFixedOverlapLayerDetour(improvedRoutes)
    this.finalOwnerIterationLimit += MAX_FINAL_OWNER_B01_ITERATIONS
    improvedRoutes = this.runB01FinalErrorOwnerSweep(improvedRoutes)
    improvedRoutes = this.runPostClusterViaMicroShiftCleanup(improvedRoutes)
    improvedRoutes = this.runFinalEndpointSlideCleanup(improvedRoutes)
    improvedRoutes = this.runFinalContinuityTerminalViaBridge(improvedRoutes)
    improvedRoutes =
      this.normalizeViaMetadataFromLayerTransitions(improvedRoutes)

    return this.restoreTerminalIds(improvedRoutes)
  }

  override _step(): void {
    if (!this.cleanupStarted) {
      super._step()
      if (!this.solved) return
      this.cleanupStarted = true
      this.solved = false
    }

    const inheritedRepairSnapshot = this.getSnapshot(this.outputHdRoutes)
    const initialHypergraphSnapshot = this.getSnapshot(this.initialHdRoutes)
    const inheritedFixedCopperIssueCount = this.getFixedCopperIssueCount(
      inheritedRepairSnapshot,
    )
    const initialFixedCopperIssueCount = this.getFixedCopperIssueCount(
      initialHypergraphSnapshot,
    )
    const cleanupInputRoutes =
      initialFixedCopperIssueCount < inheritedFixedCopperIssueCount ||
      (initialFixedCopperIssueCount === inheritedFixedCopperIssueCount &&
        initialHypergraphSnapshot.count < inheritedRepairSnapshot.count)
        ? this.initialHdRoutes
        : this.outputHdRoutes
    this.outputHdRoutes = this.runPipeline9Cleanup(cleanupInputRoutes)
    const finalSnapshot = this.getSnapshot(this.outputHdRoutes)
    this.stats = {
      ...this.stats,
      pipeline9InheritedRepairDrcIssueCount: inheritedRepairSnapshot.count,
      pipeline9InheritedRepairFixedCopperIssueCount:
        inheritedFixedCopperIssueCount,
      pipeline9InitialHypergraphDrcIssueCount: initialHypergraphSnapshot.count,
      pipeline9InitialHypergraphFixedCopperIssueCount:
        initialFixedCopperIssueCount,
      pipeline9CleanupUsedInitialHypergraphRoutes:
        cleanupInputRoutes === this.initialHdRoutes,
      finalDrcIssueCount: finalSnapshot.count,
      pipeline9DrcCleanupCandidateAttempts: this.cleanupCandidateAttempts,
      pipeline9DrcCleanupCandidatesAccepted: this.cleanupCandidatesAccepted,
      pipeline9LocalCleanupDrcEvaluations: this.localCleanupDrcEvaluations,
      pipeline9SelectedLocalCleanupDrcEvaluationLimit:
        this.selectedLocalCleanupDrcEvaluationLimit,
      pipeline9ConsecutiveLocalCleanupDrcMisses:
        this.consecutiveLocalCleanupDrcMisses,
      pipeline9MaxConsecutiveLocalCleanupDrcMisses:
        this.maxConsecutiveLocalCleanupDrcMisses,
      pipeline9SelectedConsecutiveLocalCleanupDrcMissLimit:
        this.selectedConsecutiveLocalCleanupDrcMissLimit,
      pipeline9ViaMicroShiftAttempts: this.viaMicroShiftAttempts,
      pipeline9ViaMicroShiftsAccepted: this.viaMicroShiftsAccepted,
      pipeline9B01FullAttempts: this.b01FullAttempts,
      pipeline9B01InteriorAttempts: this.b01InteriorAttempts,
      pipeline9B01FixedOnlyAttempts: this.b01FixedOnlyAttempts,
      pipeline9B01CandidatesAccepted: this.b01CandidatesAccepted,
      pipeline9B01Iterations: this.b01Iterations,
      pipeline9SelectedB01IterationLimit: this.selectedB01IterationLimit,
      pipeline9ErrorOwnedClusterOrderAttempts:
        this.errorOwnedClusterOrderAttempts,
      pipeline9ErrorOwnedClusterRouteAttempts:
        this.errorOwnedClusterRouteAttempts,
      pipeline9ErrorOwnedClusterDrcEvaluations:
        this.errorOwnedClusterDrcEvaluations,
      pipeline9ErrorOwnedClusterIterations: this.errorOwnedClusterIterations,
      pipeline9ErrorOwnedClusterAccepted: this.errorOwnedClusterAccepted,
      pipeline9ErrorOwnedClusterTerminalEscapeAttempts:
        this.errorOwnedClusterTerminalEscapeAttempts,
      pipeline9ErrorOwnedClusterPostRouteAttempts:
        this.errorOwnedClusterPostRouteAttempts,
      pipeline9ErrorOwnedClusterPostCandidatesAccepted:
        this.errorOwnedClusterPostCandidatesAccepted,
      pipeline9PostClusterViaMicroShiftDrcEvaluations:
        this.postClusterViaMicroShiftDrcEvaluations,
      pipeline9FinalOwnerFullAttempts: this.finalOwnerFullAttempts,
      pipeline9FinalOwnerInteriorAttempts: this.finalOwnerInteriorAttempts,
      pipeline9FinalOwnerDrcEvaluations: this.finalOwnerDrcEvaluations,
      pipeline9FinalOwnerCandidatesAccepted: this.finalOwnerCandidatesAccepted,
      pipeline9FinalOwnerIterations: this.finalOwnerIterations,
      pipeline9FinalOwnerIterationLimit: this.finalOwnerIterationLimit,
      pipeline9PostRepairSameNetViaMergeAttempts:
        this.postRepairSameNetViaMergeAttempts,
      pipeline9PostRepairSameNetViaMergeDrcEvaluations:
        this.postRepairSameNetViaMergeDrcEvaluations,
      pipeline9PostRepairSameNetViaMergeCandidatesAccepted:
        this.postRepairSameNetViaMergeCandidatesAccepted,
      pipeline9PostRepairSameNetViaMergeIterations:
        this.postRepairSameNetViaMergeIterations,
      pipeline9PostRepairSameNetViaMergeIterationLimit:
        MAX_POST_REPAIR_SAME_NET_VIA_MERGER_ITERATIONS,
      pipeline9SharedTerminalCompositeAttempts:
        this.sharedTerminalCompositeAttempts,
      pipeline9SharedTerminalCompositeRelocatedBranches:
        this.sharedTerminalCompositeRelocatedBranches,
      pipeline9SharedTerminalCompositeB01Attempts:
        this.sharedTerminalCompositeB01Attempts,
      pipeline9SharedTerminalCompositeDrcEvaluations:
        this.sharedTerminalCompositeDrcEvaluations,
      pipeline9SharedTerminalCompositeCandidatesAccepted:
        this.sharedTerminalCompositeCandidatesAccepted,
      pipeline9SharedTerminalCompositeIterations:
        this.sharedTerminalCompositeIterations,
      pipeline9SharedTerminalCompositeIterationLimit:
        MAX_SHARED_TERMINAL_COMPOSITE_B01_ITERATIONS,
      pipeline9PostFinalCompositeAttempts: this.postFinalCompositeAttempts,
      pipeline9PostFinalCompositeForwardAttempts:
        this.postFinalCompositeForwardAttempts,
      pipeline9PostFinalCompositeReverseAttempts:
        this.postFinalCompositeReverseAttempts,
      pipeline9PostFinalCompositeTerminalRootedAttempts:
        this.postFinalCompositeTerminalRootedAttempts,
      pipeline9PostFinalCompositeDrcEvaluations:
        this.postFinalCompositeDrcEvaluations,
      pipeline9PostFinalCompositeCandidatesAccepted:
        this.postFinalCompositeCandidatesAccepted,
      pipeline9PostFinalCompositeIterations: this.postFinalCompositeIterations,
      pipeline9PostFinalCompositeIterationLimit:
        MAX_POST_FINAL_COMPOSITE_B01_ITERATIONS,
      pipeline9PostFinalCompositeSameNetViaMergeIterations:
        this.postFinalCompositeSameNetViaMergeIterations,
      pipeline9PostFinalCompositeSameNetViaMergeIterationLimit:
        MAX_POST_FINAL_COMPOSITE_SAME_NET_VIA_MERGER_ITERATIONS,
      pipeline9AnchoredFixedCopperAttempts: this.anchoredFixedCopperAttempts,
      pipeline9AnchoredFixedCopperDrcEvaluations:
        this.anchoredFixedCopperDrcEvaluations,
      pipeline9AnchoredFixedCopperCandidatesAccepted:
        this.anchoredFixedCopperCandidatesAccepted,
      pipeline9AnchoredFixedCopperIterations:
        this.anchoredFixedCopperIterations,
      pipeline9AnchoredFixedCopperAttemptLimit:
        MAX_ANCHORED_FIXED_COPPER_ATTEMPTS,
      pipeline9AnchoredFixedCopperDrcEvaluationLimit:
        MAX_ANCHORED_FIXED_COPPER_DRC_EVALUATIONS,
      pipeline9AnchoredFixedCopperIterationLimit:
        MAX_ANCHORED_FIXED_COPPER_ITERATIONS,
      pipeline9FixedCopperCompositePrimaryAttempts:
        this.fixedCopperCompositePrimaryAttempts,
      pipeline9FixedCopperCompositeFollowupAttempts:
        this.fixedCopperCompositeFollowupAttempts,
      pipeline9FixedCopperCompositeDrcEvaluations:
        this.fixedCopperCompositeDrcEvaluations,
      pipeline9FixedCopperCompositeCandidatesAccepted:
        this.fixedCopperCompositeCandidatesAccepted,
      pipeline9FixedCopperCompositeIterations:
        this.fixedCopperCompositeIterations,
      pipeline9FixedCopperCompositePrimaryAttemptLimit:
        MAX_FIXED_COPPER_COMPOSITE_PRIMARY_ATTEMPTS,
      pipeline9FixedCopperCompositeFollowupAttemptLimit:
        MAX_FIXED_COPPER_COMPOSITE_FOLLOWUP_ATTEMPTS,
      pipeline9FixedCopperCompositeDrcEvaluationLimit:
        MAX_FIXED_COPPER_COMPOSITE_DRC_EVALUATIONS,
      pipeline9FixedCopperCompositeIterationLimit:
        MAX_FIXED_COPPER_COMPOSITE_ITERATIONS,
      pipeline9FinalEndpointSlideAttempts: this.finalEndpointSlideAttempts,
      pipeline9FinalEndpointSlideDrcEvaluations:
        this.finalEndpointSlideDrcEvaluations,
      pipeline9FinalEndpointSlideCandidatesAccepted:
        this.finalEndpointSlideCandidatesAccepted,
      pipeline9FinalEndpointSlideRelocatedBranches:
        this.finalEndpointSlideRelocatedBranches,
      pipeline9FinalEndpointSlideDrcEvaluationLimit:
        MAX_FINAL_ENDPOINT_SLIDE_DRC_EVALUATIONS,
      pipeline9FinalContinuityTerminalViaAttempts:
        this.finalContinuityTerminalViaAttempts,
      pipeline9FinalContinuityTerminalViaDrcEvaluations:
        this.finalContinuityTerminalViaDrcEvaluations,
      pipeline9FinalContinuityTerminalViaCandidatesAccepted:
        this.finalContinuityTerminalViaCandidatesAccepted,
      pipeline9FinalContinuityTerminalViaAttemptLimit:
        MAX_FINAL_CONTINUITY_TERMINAL_VIA_ATTEMPTS,
      pipeline9FinalContinuityTerminalViaDrcEvaluationLimit:
        MAX_FINAL_CONTINUITY_TERMINAL_VIA_DRC_EVALUATIONS,
      pipeline9FinalFixedOverlapLayerDetourDrcEvaluations:
        this.finalFixedOverlapLayerDetourDrcEvaluations,
      pipeline9FinalFixedOverlapLayerDetourCandidatesAccepted:
        this.finalFixedOverlapLayerDetourCandidatesAccepted,
      pipeline9FinalFixedOverlapLayerDetourDrcEvaluationLimit:
        MAX_FINAL_FIXED_OVERLAP_LAYER_DETOUR_DRC_EVALUATIONS,
      pipeline9FinalFixedOverlapBestRemovedTargetIssueCount: Number.isFinite(
        this.finalFixedOverlapBestRemovedTargetIssueCount,
      )
        ? this.finalFixedOverlapBestRemovedTargetIssueCount
        : undefined,
      pipeline9FinalFixedOverlapBestRemovedTargetFixedScore: Number.isFinite(
        this.finalFixedOverlapBestRemovedTargetFixedScore,
      )
        ? this.finalFixedOverlapBestRemovedTargetFixedScore
        : undefined,
    }
    this.progress = 1
    this.solved = true
  }
}
