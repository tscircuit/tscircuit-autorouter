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
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

type Pipeline9ExactDrcRepairSolverParams =
  GlobalDrcBranchPortfolioSolverParams & {
    originalObstacles: Obstacle[]
  }

type DrcError = Record<string, unknown>

type TerminalConstraint = {
  routeIndex: number
  endpoint: "start" | "end"
  originalPoint: HighDensityRoute["route"][number]
  traceRadius: number
  owningObstacles: Obstacle[]
}

const POSITION_EPSILON = 1e-6
const ENDPOINT_SLIDE_RADII = [
  0.025, 0.05, 0.075, 0.1, 0.125, 0.15, 0.2, 0.25, 0.3,
] as const
const BATCHED_TRACE_FORCE_SCALES = [4, 2, 1, 0.5, 0.25] as const
const MAX_BATCHED_TRACE_FORCE_PASSES = 20
const MAX_CLEANUP_PASSES = 8
const MAX_LOCAL_LAYER_DETOUR_EXPANSION = 6

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
): boolean =>
  obstacle.connectedTo.find((id) => id.startsWith("pcb_smtpad_")) === padId ||
  obstacle.connectedTo.find((id) => id.startsWith("pcb_plated_hole_")) === padId

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
  private readonly terminalConstraints: TerminalConstraint[]
  private cleanupStarted = false
  private cleanupCandidateAttempts = 0
  private cleanupCandidatesAccepted = 0

  constructor(params: Pipeline9ExactDrcRepairSolverParams) {
    super(params)
    this.originalObstacles = params.originalObstacles
    this.terminalConstraints = params.hdRoutes.flatMap((route, routeIndex) =>
      (["start", "end"] as const).flatMap((endpoint) => {
        const point = endpoint === "start" ? route.route[0] : route.route.at(-1)
        if (!point) return []
        const traceRadius =
          (route.traceThickness ?? params.srj.minTraceWidth) / 2
        const owningObstacles = params.originalObstacles.filter(
          (obstacle) =>
            obstacleSharesRouteNet(obstacle, route) &&
            obstacleAppliesToLayer(obstacle, point.z, params.srj.layerCount) &&
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
    currentIssueCount: number,
  ): boolean {
    this.cleanupCandidateAttempts += 1
    if (!this.candidatePreservesTerminals(candidateRoutes)) return false

    const candidateSnapshot = this.getSnapshot(candidateRoutes)
    if (candidateSnapshot.count >= currentIssueCount) return false
    this.cleanupCandidatesAccepted += 1
    return true
  }

  private tryEndpointSlide(
    routes: HighDensityRoute[],
    error: DrcError,
  ): HighDensityRoute[] | undefined {
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
          if (
            this.candidateImprovesSnapshot(
              materializedCandidate,
              snapshot.count,
            )
          ) {
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
  ): HighDensityRoute[] | undefined {
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

      for (
        let expansion = 0;
        expansion <= MAX_LOCAL_LAYER_DETOUR_EXPANSION;
        expansion += 1
      ) {
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
          if (
            this.candidateImprovesSnapshot(
              materializedCandidate,
              snapshot.count,
            )
          ) {
            return materializedCandidate
          }
        }
      }
    }

    return undefined
  }

  private tryBatchedTraceForce(
    routes: HighDensityRoute[],
    error: DrcError,
  ): HighDensityRoute[] | undefined {
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
          if (
            this.candidateImprovesSnapshot(
              materializedCandidate,
              snapshot.count,
            )
          ) {
            return materializedCandidate
          }
          candidateRoutes = cloneRoutes(materializedCandidate)
        }
      }
    }

    return undefined
  }

  private runPipeline9Cleanup(routes: HighDensityRoute[]): HighDensityRoute[] {
    let improvedRoutes = this.unlockCleanupTerminals(routes)

    for (let pass = 0; pass < MAX_CLEANUP_PASSES; pass += 1) {
      const snapshot = this.getSnapshot(improvedRoutes)
      if (snapshot.count === 0) break

      let nextRoutes: HighDensityRoute[] | undefined
      for (const error of snapshot.errors) {
        nextRoutes = this.tryEndpointSlide(improvedRoutes, error)
        if (nextRoutes) break
      }
      if (!nextRoutes) {
        for (const error of snapshot.errors) {
          nextRoutes = this.tryLocalTraceLayerDetour(improvedRoutes, error)
          if (nextRoutes) break
        }
      }
      if (!nextRoutes) {
        for (const error of snapshot.errors) {
          nextRoutes = this.tryBatchedTraceForce(improvedRoutes, error)
          if (nextRoutes) break
        }
      }
      if (!nextRoutes) break
      improvedRoutes = nextRoutes
    }

    return this.restoreTerminalIds(improvedRoutes)
  }

  override _step(): void {
    if (!this.cleanupStarted) {
      super._step()
      if (!this.solved) return
      this.cleanupStarted = true
      this.solved = false
    }

    this.outputHdRoutes = this.runPipeline9Cleanup(this.outputHdRoutes)
    const finalSnapshot = this.getSnapshot(this.outputHdRoutes)
    this.stats = {
      ...this.stats,
      finalDrcIssueCount: finalSnapshot.count,
      pipeline9DrcCleanupCandidateAttempts: this.cleanupCandidateAttempts,
      pipeline9DrcCleanupCandidatesAccepted: this.cleanupCandidatesAccepted,
    }
    this.progress = 1
    this.solved = true
  }
}
