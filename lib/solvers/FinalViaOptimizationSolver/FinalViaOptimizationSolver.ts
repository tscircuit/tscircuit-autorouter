import type { DrcEvaluator } from "high-density-repair03/lib"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { Obstacle, SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import { createRouteQualitySnapshot, type RouteQualitySnapshot } from "./create-route-quality-snapshot"
import { getProtectedConnectionNames } from "./get-protected-connection-names"
import { getSameLayerSpanCollapseCandidates } from "./try-collapse-same-layer-span"

const MAX_CANDIDATE_ATTEMPTS = 32

const structurallyEqual = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

const isProtectedRoute = (
  route: HighDensityRoute,
  protectedConnectionNames: ReadonlySet<string>,
  obstacles: ReadonlyArray<Obstacle>,
  connMap: ConnectivityMap,
): boolean =>
  protectedConnectionNames.has(route.connectionName) ||
  protectedConnectionNames.has(route.rootConnectionName ?? "") ||
  Boolean(route.jumpers?.length) ||
  route.route.some(
    (point, index) =>
      point.insideJumperPad ||
      point.toNextSegmentType === "through_obstacle" ||
      (index > 0 && index < route.route.length - 1 && point.pcb_port_id),
  ) ||
  route.vias.some((via) =>
    obstacles.some(
      (obstacle) =>
        Math.abs(via.x - obstacle.center.x) <= obstacle.width / 2 + 1e-6 &&
        Math.abs(via.y - obstacle.center.y) <= obstacle.height / 2 + 1e-6 &&
        obstacle.connectedTo.some(
          (id) =>
            id === route.connectionName ||
            id === route.rootConnectionName ||
            connMap.areIdsConnected(id, route.connectionName) ||
            (route.rootConnectionName !== undefined &&
              connMap.areIdsConnected(id, route.rootConnectionName)),
        ),
    ),
  )

const hasSameIdentityAndTerminals = (
  baseline: HighDensityRoute,
  candidate: HighDensityRoute,
): boolean => {
  const baselineStart = baseline.route[0]
  const baselineEnd = baseline.route[baseline.route.length - 1]
  const candidateStart = candidate.route[0]
  const candidateEnd = candidate.route[candidate.route.length - 1]
  return Boolean(
    baselineStart &&
      baselineEnd &&
      candidateStart &&
      candidateEnd &&
      baseline.connectionName === candidate.connectionName &&
      baseline.rootConnectionName === candidate.rootConnectionName &&
      baseline.startPcbPortId === candidate.startPcbPortId &&
      baseline.endPcbPortId === candidate.endPcbPortId &&
      baselineStart.x === candidateStart.x &&
      baselineStart.y === candidateStart.y &&
      baselineEnd.x === candidateEnd.x &&
      baselineEnd.y === candidateEnd.y &&
      baselineStart.pcb_port_id === candidateStart.pcb_port_id &&
      baselineEnd.pcb_port_id === candidateEnd.pcb_port_id,
  )
}

/** Final, transactional via reduction after all DRC and pair post-processing. */
export class FinalViaOptimizationSolver extends BaseSolver {
  override getSolverName(): string {
    return "FinalViaOptimizationSolver"
  }

  hdRoutes: HighDensityRoute[]
  private readonly candidateConnectionQueue: string[]
  private readonly rejectedCandidateKeys = new Map<string, Set<string>>()
  private readonly protectedConnectionNames: Set<string>
  private readonly obstacleSHI: ObstacleSpatialHashIndex
  private attempts = 0
  private quality: RouteQualitySnapshot

  constructor(
    private readonly input: {
      hdRoutes: HighDensityRoute[]
      originalSrj: SimpleRouteJson
      obstacles: Obstacle[]
      layerCount: number
      connMap: ConnectivityMap
      convert: (routes: HighDensityRoute[]) => SimplifiedPcbTraces
      productionDrcEvaluator: DrcEvaluator
      relaxedDrcEvaluator: DrcEvaluator
    },
  ) {
    super()
    this.hdRoutes = structuredClone(input.hdRoutes)
    this.protectedConnectionNames = getProtectedConnectionNames({
      originalSrj: input.originalSrj,
      hdRoutes: input.hdRoutes,
    })
    this.obstacleSHI = new ObstacleSpatialHashIndex(
      "flatbush",
      createObjectsWithZLayers(input.obstacles, input.layerCount),
    )
    this.candidateConnectionQueue = this.hdRoutes
      .filter(
        (route) =>
          !isProtectedRoute(
            route,
            this.protectedConnectionNames,
            input.obstacles,
            input.connMap,
          ),
      )
      .map((route) => route.connectionName)
      .sort()
    this.quality = createRouteQualitySnapshot({
      hdRoutes: this.hdRoutes,
      convert: input.convert,
      productionDrcEvaluator: input.productionDrcEvaluator,
      relaxedDrcEvaluator: input.relaxedDrcEvaluator,
    })
    this.stats = {
      initialOutputViaCount: this.quality.outputViaCount,
      finalOutputViaCount: this.quality.outputViaCount,
      removedViaCount: 0,
      attemptedCandidateCount: 0,
      acceptedCandidateCount: 0,
      rejectedByCollisionCount: 0,
      rejectedByConnectivityCount: 0,
      rejectedByMetadataCount: 0,
      rejectedByProductionDrcCount: 0,
      rejectedByRelaxedDrcCount: 0,
      rejectedByTraceLengthCount: 0,
    }
  }

  private getCandidateRoutes(
    routeIndex: number,
  ): Array<{ routes: HighDensityRoute[]; key: string }> {
    const route = this.hdRoutes[routeIndex]
    if (!route)
      throw new Error("FinalViaOptimizationSolver route index is invalid")
    const rejectedKeys = this.rejectedCandidateKeys.get(route.connectionName)
    const candidates = getSameLayerSpanCollapseCandidates({
      route: structuredClone(route),
      hdRouteSHI: new HighDensityRouteSpatialIndex(this.hdRoutes),
      obstacleSHI: this.obstacleSHI,
      connMap: this.input.connMap,
      outline: this.input.originalSrj.outline,
    })
    return candidates
      .map(({ route: candidateRoute }) => {
        const routes = structuredClone(this.hdRoutes)
        routes[routeIndex] = candidateRoute
        return {
          routes,
          key: candidateRoute.route
            .map((point) => `${point.x}:${point.y}:${point.z}`)
            .join("|"),
        }
      })
      .filter(({ key }) => !rejectedKeys?.has(key))
  }

  private queueAnotherCandidate(connectionName: string): void {
    if (!this.candidateConnectionQueue.includes(connectionName)) {
      this.candidateConnectionQueue.push(connectionName)
    }
  }

  private rejectCandidate(connectionName: string, key: string): void {
    const rejectedKeys = this.rejectedCandidateKeys.get(connectionName)
    if (rejectedKeys) rejectedKeys.add(key)
    else this.rejectedCandidateKeys.set(connectionName, new Set([key]))
    this.queueAnotherCandidate(connectionName)
  }

  private hasValidRollbackInvariant(candidateRoutes: HighDensityRoute[]): boolean {
    if (candidateRoutes.length !== this.hdRoutes.length) return false
    return candidateRoutes.every((route, index) => {
      const acceptedRoute = this.hdRoutes[index]
      if (!acceptedRoute || !hasSameIdentityAndTerminals(acceptedRoute, route)) {
        return false
      }
      return !isProtectedRoute(
        acceptedRoute,
        this.protectedConnectionNames,
        this.input.obstacles,
        this.input.connMap,
      ) ||
        structurallyEqual(acceptedRoute, route)
    })
  }

  _step(): void {
    if (
      this.candidateConnectionQueue.length === 0 ||
      this.attempts >= MAX_CANDIDATE_ATTEMPTS
    ) {
      this.stats.finalOutputViaCount = this.quality.outputViaCount
      this.stats.removedViaCount =
        this.stats.initialOutputViaCount - this.quality.outputViaCount
      this.solved = true
      return
    }

    const connectionName = this.candidateConnectionQueue.shift()!
    const routeIndex = this.hdRoutes.findIndex(
      (route) => route.connectionName === connectionName,
    )
    if (routeIndex < 0)
      throw new Error(
        `FinalViaOptimizationSolver lost route "${connectionName}"`,
      )
    this.attempts++
    this.stats.attemptedCandidateCount++
    const candidate = this.getCandidateRoutes(routeIndex)[0]
    if (!candidate) {
      this.stats.rejectedByCollisionCount++
      return
    }
    if (!this.hasValidRollbackInvariant(candidate.routes)) {
      this.stats.rejectedByConnectivityCount++
      this.rejectCandidate(connectionName, candidate.key)
      return
    }

    const convertedCandidate = this.input.convert(candidate.routes)
    const convertedCandidateViaCount = convertedCandidate.reduce(
      (count, trace) =>
        count +
        trace.route.filter((segment) => segment.route_type === "via").length,
      0,
    )
    if (convertedCandidateViaCount >= this.quality.outputViaCount) {
      this.stats.rejectedByMetadataCount++
      this.rejectCandidate(connectionName, candidate.key)
      return
    }

    const candidateQuality = createRouteQualitySnapshot({
      hdRoutes: candidate.routes,
      convert: this.input.convert,
      productionDrcEvaluator: this.input.productionDrcEvaluator,
      relaxedDrcEvaluator: this.input.relaxedDrcEvaluator,
    })
    if (
      candidateQuality.productionDrcErrorCount >
        this.quality.productionDrcErrorCount ||
      candidateQuality.productionDrcIssueScore >
        this.quality.productionDrcIssueScore
    ) {
      this.stats.rejectedByProductionDrcCount++
      this.rejectCandidate(connectionName, candidate.key)
      return
    }
    if (
      candidateQuality.relaxedDrcErrorCount >
      this.quality.relaxedDrcErrorCount
    ) {
      this.stats.rejectedByRelaxedDrcCount++
      this.rejectCandidate(connectionName, candidate.key)
      return
    }
    if (candidateQuality.outputViaCount >= this.quality.outputViaCount) {
      this.stats.rejectedByMetadataCount++
      this.rejectCandidate(connectionName, candidate.key)
      return
    }
    if (
      candidateQuality.totalTraceLength > this.quality.totalTraceLength + 1e-6
    ) {
      this.stats.rejectedByTraceLengthCount++
      this.rejectCandidate(connectionName, candidate.key)
      return
    }

    this.hdRoutes = candidate.routes
    this.quality = candidateQuality
    this.stats.acceptedCandidateCount++
    this.rejectedCandidateKeys.delete(connectionName)
    this.queueAnotherCandidate(connectionName)
  }

  getOutput(): HighDensityRoute[] {
    if (!this.solved)
      throw new Error("FinalViaOptimizationSolver output requested before solve")
    return this.hdRoutes
  }
}
