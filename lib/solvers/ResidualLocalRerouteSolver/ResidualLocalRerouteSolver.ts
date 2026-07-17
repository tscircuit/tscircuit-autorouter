import {
  isPointInsidePolygon,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import type { DrcEvaluator } from "high-density-repair03/lib"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"

type Point = { x: number; y: number }

type Bounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

type DrcError = Record<string, unknown>

type DrcSnapshot = {
  errors: DrcError[]
  issueCount: number
  issueScore: number
}

type DoglegStrategy = {
  offset: number
  span: number
}

type CandidatePlanEntry = DoglegStrategy & {
  routeIndex: number
  center: Point
}

export type ResidualLocalRerouteSolverConfig = {
  hdRoutes: readonly HighDensityRoute[]
  drcEvaluator: DrcEvaluator
  bounds: Bounds
  outline?: readonly Point[]
  effort: number
  maxCandidateAttempts: number
  maxAcceptedMoves: number
}

const ALL_DOGLEG_STRATEGIES: readonly DoglegStrategy[] = [
  { offset: -0.2, span: 0.24 },
  { offset: 0.2, span: 0.24 },
  { offset: -0.12, span: 0.24 },
  { offset: 0.12, span: 0.24 },
  { offset: -0.32, span: 0.24 },
  { offset: 0.32, span: 0.24 },
  { offset: -0.2, span: 0.12 },
  { offset: 0.2, span: 0.12 },
  { offset: -0.2, span: 0.4 },
  { offset: 0.2, span: 0.4 },
  { offset: -0.12, span: 0.12 },
  { offset: 0.12, span: 0.12 },
  { offset: -0.12, span: 0.4 },
  { offset: 0.12, span: 0.4 },
  { offset: -0.32, span: 0.12 },
  { offset: 0.32, span: 0.12 },
  { offset: -0.32, span: 0.4 },
  { offset: 0.32, span: 0.4 },
  { offset: -0.48, span: 0.4 },
  { offset: 0.48, span: 0.4 },
  { offset: -0.48, span: 0.7 },
  { offset: 0.48, span: 0.7 },
  { offset: -0.64, span: 0.7 },
  { offset: 0.64, span: 0.7 },
]

const SUPPORTED_ERROR_TYPES = new Set([
  "pcb_trace_error",
  "pcb_via_trace_clearance_error",
  "pcb_pad_trace_clearance_error",
])

const getDrcErrorSeverity = (error: DrcError): number => {
  const message = typeof error.message === "string" ? error.message : ""
  const gap = Number.parseFloat(
    message.match(/gap: (-?\d+(?:\.\d+)?)mm/)?.[1] ?? "",
  )
  const required = Number.parseFloat(
    message.match(/required: (-?\d+(?:\.\d+)?)mm/)?.[1] ?? "",
  )
  if (Number.isFinite(gap) && Number.isFinite(required)) {
    return Math.max(0, required - gap)
  }

  const clearance = Number.parseFloat(
    message.match(/clearance: (-?\d+(?:\.\d+)?)mm/)?.[1] ?? "",
  )
  const minimum = Number.parseFloat(
    message.match(/minimum: (-?\d+(?:\.\d+)?)mm/)?.[1] ?? "",
  )
  return Number.isFinite(clearance) && Number.isFinite(minimum)
    ? Math.max(0, minimum - clearance)
    : 1
}

const getErrorCenter = (error: DrcError): Point | undefined => {
  const center = error.center ?? error.pcb_center
  if (!center || typeof center !== "object") return undefined
  const candidate = center as Record<string, unknown>
  if (typeof candidate.x !== "number" || typeof candidate.y !== "number") {
    return undefined
  }
  return { x: candidate.x, y: candidate.y }
}

const isBetterSnapshot = (
  candidate: DrcSnapshot,
  best: DrcSnapshot,
): boolean => {
  if (candidate.issueCount !== best.issueCount) {
    return candidate.issueCount < best.issueCount
  }
  return candidate.issueScore < best.issueScore - 1e-9
}

const isPointInsideBoard = (
  point: Point,
  polygon: readonly Point[],
  traceRadius: number,
): boolean => {
  if (!isPointInsidePolygon(point, polygon)) return false
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]!
    const end = polygon[(index + 1) % polygon.length]!
    if (pointToSegmentDistance(point, start, end) < traceRadius - 1e-6) {
      return false
    }
  }
  return true
}

const doesDoglegStayInsideBoard = (
  doglegPoints: readonly Point[],
  polygon: readonly Point[],
  traceRadius: number,
): boolean => {
  for (
    let segmentIndex = 0;
    segmentIndex + 1 < doglegPoints.length;
    segmentIndex += 1
  ) {
    const start = doglegPoints[segmentIndex]!
    const end = doglegPoints[segmentIndex + 1]!
    for (let sampleIndex = 1; sampleIndex < 10; sampleIndex += 1) {
      const t = sampleIndex / 10
      const point = {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      }
      if (!isPointInsideBoard(point, polygon, traceRadius)) return false
    }
  }
  return true
}

const getBoardPolygon = (
  bounds: Bounds,
  outline?: readonly Point[],
): readonly Point[] => {
  if (outline && outline.length >= 3) return outline
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ]
}

const getTraceRouteIndexById = (
  routes: readonly HighDensityRoute[],
): Map<string, number> => {
  const routeCountByConnectionName = new Map<string, number>()
  const routeIndexByTraceId = new Map<string, number>()
  routes.forEach((route, routeIndex) => {
    const connectionRouteIndex =
      routeCountByConnectionName.get(route.connectionName) ?? 0
    routeIndexByTraceId.set(
      `${route.connectionName}_${connectionRouteIndex}`,
      routeIndex,
    )
    routeCountByConnectionName.set(
      route.connectionName,
      connectionRouteIndex + 1,
    )
  })
  return routeIndexByTraceId
}

const getTraceIdsForError = (error: DrcError): string[] => {
  const traceIds = error.pcb_trace_ids
  if (Array.isArray(traceIds)) {
    return [
      ...new Set(traceIds.filter((id): id is string => typeof id === "string")),
    ]
  }
  return typeof error.pcb_trace_id === "string" ? [error.pcb_trace_id] : []
}

const insertDogleg = (
  routes: HighDensityRoute[],
  routeIndex: number,
  center: Point,
  strategy: DoglegStrategy,
  boardPolygon: readonly Point[],
): boolean => {
  const route = routes[routeIndex]
  if (!route) return false
  let nearest:
    | { segmentIndex: number; t: number; distance: number; length: number }
    | undefined

  for (
    let segmentIndex = 0;
    segmentIndex + 1 < route.route.length;
    segmentIndex += 1
  ) {
    const start = route.route[segmentIndex]!
    const end = route.route[segmentIndex + 1]!
    if (
      start.z !== end.z ||
      start.toNextSegmentType === "through_obstacle" ||
      start.insideJumperPad ||
      end.insideJumperPad
    ) {
      continue
    }
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared <= 1e-8) continue
    const t = Math.max(
      0,
      Math.min(
        1,
        ((center.x - start.x) * dx + (center.y - start.y) * dy) / lengthSquared,
      ),
    )
    const projectedPoint = { x: start.x + dx * t, y: start.y + dy * t }
    const distance = Math.hypot(
      center.x - projectedPoint.x,
      center.y - projectedPoint.y,
    )
    if (!nearest || distance < nearest.distance) {
      nearest = {
        segmentIndex,
        t,
        distance,
        length: Math.sqrt(lengthSquared),
      }
    }
  }
  if (!nearest) return false

  const start = route.route[nearest.segmentIndex]!
  const end = route.route[nearest.segmentIndex + 1]!
  const dx = end.x - start.x
  const dy = end.y - start.y
  const normalX = -dy / nearest.length
  const normalY = dx / nearest.length
  const halfSpanT = Math.min(0.45, strategy.span / nearest.length)
  const beforeT = Math.max(0.02, nearest.t - halfSpanT)
  const afterT = Math.min(0.98, nearest.t + halfSpanT)
  if (afterT - beforeT < 0.02) return false

  const beforePoint = {
    x: start.x + dx * beforeT + normalX * strategy.offset,
    y: start.y + dy * beforeT + normalY * strategy.offset,
  }
  const afterPoint = {
    x: start.x + dx * afterT + normalX * strategy.offset,
    y: start.y + dy * afterT + normalY * strategy.offset,
  }
  if (
    !doesDoglegStayInsideBoard(
      [start, beforePoint, afterPoint, end],
      boardPolygon,
      (route.traceThickness ?? 0.1) / 2,
    )
  ) {
    return false
  }

  const {
    pcb_port_id: _pcbPortId,
    insideJumperPad: _insideJumperPad,
    toNextSegmentType: _toNextSegmentType,
    ...insertedPointFields
  } = start
  route.route.splice(
    nearest.segmentIndex + 1,
    0,
    { ...insertedPointFields, ...beforePoint },
    { ...insertedPointFields, ...afterPoint },
  )
  return true
}

/**
 * Searches bounded local doglegs around residual, location-aware DRC errors.
 * Every candidate is validated against the complete DRC snapshot and accepted
 * only when issue count or severity strictly improves.
 */
export class ResidualLocalRerouteSolver extends BaseSolver {
  private readonly inputHdRoutes: readonly HighDensityRoute[]
  private readonly boardPolygon: readonly Point[]
  private readonly strategies: readonly DoglegStrategy[]
  private bestRoutes: HighDensityRoute[]
  private bestSnapshot?: DrcSnapshot
  private candidatePlan: CandidatePlanEntry[] = []
  private candidatePlanIndex = 0
  private candidateAttempts = 0
  private acceptedMoves = 0
  private sweepsStarted = 0

  constructor(private readonly config: ResidualLocalRerouteSolverConfig) {
    super()
    if (!Number.isFinite(config.effort) || config.effort <= 0) {
      throw new Error("effort must be a positive finite number")
    }
    if (
      !Number.isInteger(config.maxCandidateAttempts) ||
      config.maxCandidateAttempts < 0
    ) {
      throw new Error("maxCandidateAttempts must be a non-negative integer")
    }
    if (
      !Number.isInteger(config.maxAcceptedMoves) ||
      config.maxAcceptedMoves < 0
    ) {
      throw new Error("maxAcceptedMoves must be a non-negative integer")
    }
    this.inputHdRoutes = config.hdRoutes
    this.bestRoutes = config.hdRoutes.map((route) => structuredClone(route))
    this.boardPolygon = getBoardPolygon(config.bounds, config.outline)
    const strategyLimit = Math.min(
      ALL_DOGLEG_STRATEGIES.length,
      2 + Math.ceil(4 * Math.log2(Math.max(1, config.effort))),
    )
    this.strategies = ALL_DOGLEG_STRATEGIES.slice(0, strategyLimit)
    this.MAX_ITERATIONS =
      (config.maxCandidateAttempts + 1) * (config.maxAcceptedMoves + 1) + 10
  }

  override getSolverName(): string {
    return "ResidualLocalRerouteSolver"
  }

  override getConstructorParams() {
    return [
      {
        ...this.config,
        hdRoutes: this.inputHdRoutes,
      },
    ] as const
  }

  getOutput(): HighDensityRoute[] {
    return this.bestRoutes
  }

  private evaluate(routes: HighDensityRoute[]): DrcSnapshot {
    const result = this.config.drcEvaluator({
      traces: [],
      routes,
      hdRoutes: routes,
    })
    const rawErrors = Array.isArray(result) ? result : result.errors
    const errorsWithCenters = Array.isArray(result)
      ? result
      : (result.errorsWithCenters ?? result.errors)
    return {
      errors: errorsWithCenters,
      issueCount: rawErrors.length,
      issueScore: rawErrors.reduce(
        (score, error) => score + getDrcErrorSeverity(error),
        0,
      ),
    }
  }

  private buildCandidatePlan(): void {
    const snapshot = this.bestSnapshot
    if (!snapshot) {
      throw new Error("Cannot build reroute plan before DRC evaluation")
    }
    const routeIndexByTraceId = getTraceRouteIndexById(this.bestRoutes)
    const plan: CandidatePlanEntry[] = []

    snapshot.errors.forEach((error) => {
      if (!SUPPORTED_ERROR_TYPES.has(String(error.type))) return
      const center = getErrorCenter(error)
      if (!center) return
      const routeIndexes = getTraceIdsForError(error)
        .map((traceId) => routeIndexByTraceId.get(traceId))
        .filter((routeIndex): routeIndex is number => routeIndex !== undefined)
      for (const routeIndex of new Set(routeIndexes)) {
        for (const strategy of this.strategies) {
          plan.push({ routeIndex, center, ...strategy })
        }
      }
    })

    this.candidatePlan = plan
    this.candidatePlanIndex = 0
    this.sweepsStarted += 1
  }

  private finish(params: {
    stoppedAfterNoImprovement: boolean
    hitCandidateLimit?: boolean
    hitAcceptedMoveLimit?: boolean
    disabled?: boolean
  }): void {
    this.stats = {
      residualLocalRerouteDisabled: params.disabled ?? false,
      residualLocalRerouteInitialDrcIssueCount:
        this.stats.residualLocalRerouteInitialDrcIssueCount,
      residualLocalRerouteFinalDrcIssueCount: this.bestSnapshot?.issueCount,
      residualLocalRerouteFinalDrcIssueScore: this.bestSnapshot?.issueScore,
      residualLocalRerouteCandidateAttempts: this.candidateAttempts,
      residualLocalRerouteAcceptedMoves: this.acceptedMoves,
      residualLocalRerouteSweepsStarted: this.sweepsStarted,
      residualLocalRerouteStrategyCount: this.strategies.length,
      residualLocalRerouteStoppedAfterNoImprovement:
        params.stoppedAfterNoImprovement,
      residualLocalRerouteHitCandidateLimit: params.hitCandidateLimit ?? false,
      residualLocalRerouteHitAcceptedMoveLimit:
        params.hitAcceptedMoveLimit ?? false,
      residualLocalRerouteMaxCandidateAttempts:
        this.config.maxCandidateAttempts,
      residualLocalRerouteMaxAcceptedMoves: this.config.maxAcceptedMoves,
    }
    this.progress = 1
    this.solved = true
  }

  _step(): void {
    if (
      this.config.maxCandidateAttempts === 0 ||
      this.config.maxAcceptedMoves === 0
    ) {
      this.finish({ stoppedAfterNoImprovement: false, disabled: true })
      return
    }

    if (!this.bestSnapshot) {
      this.bestSnapshot = this.evaluate(this.bestRoutes)
      this.stats.residualLocalRerouteInitialDrcIssueCount =
        this.bestSnapshot.issueCount
      if (this.bestSnapshot.issueCount === 0) {
        this.finish({ stoppedAfterNoImprovement: true })
        return
      }
      this.buildCandidatePlan()
    }

    if (this.candidateAttempts >= this.config.maxCandidateAttempts) {
      this.finish({
        stoppedAfterNoImprovement: false,
        hitCandidateLimit: true,
      })
      return
    }
    const candidatePlanEntry = this.candidatePlan[this.candidatePlanIndex]
    if (!candidatePlanEntry) {
      this.finish({ stoppedAfterNoImprovement: true })
      return
    }
    this.candidatePlanIndex += 1

    const candidateRoutes = structuredClone(this.bestRoutes)
    const changed = insertDogleg(
      candidateRoutes,
      candidatePlanEntry.routeIndex,
      candidatePlanEntry.center,
      candidatePlanEntry,
      this.boardPolygon,
    )
    if (!changed) return

    this.candidateAttempts += 1
    const candidateSnapshot = this.evaluate(candidateRoutes)
    if (isBetterSnapshot(candidateSnapshot, this.bestSnapshot)) {
      this.bestRoutes = candidateRoutes
      this.bestSnapshot = candidateSnapshot
      this.acceptedMoves += 1
      if (candidateSnapshot.issueCount === 0) {
        this.finish({ stoppedAfterNoImprovement: false })
        return
      }
      if (this.acceptedMoves >= this.config.maxAcceptedMoves) {
        this.finish({
          stoppedAfterNoImprovement: false,
          hitAcceptedMoveLimit: true,
        })
        return
      }
      this.buildCandidatePlan()
    }

    this.progress = Math.min(
      0.99,
      this.candidateAttempts / Math.max(1, this.config.maxCandidateAttempts),
    )
  }
}
