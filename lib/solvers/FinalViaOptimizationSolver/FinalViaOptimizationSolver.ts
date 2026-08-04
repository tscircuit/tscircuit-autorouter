import type { DrcEvaluator } from "high-density-repair03/lib"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { Obstacle, SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import {
  createRouteQualitySnapshot,
  type RouteQualitySnapshot,
} from "./create-route-quality-snapshot"
import { getProtectedConnectionNames } from "./get-protected-connection-names"
import { getSameLayerSpanCollapseCandidates } from "./try-collapse-same-layer-span"

const MAX_CANDIDATE_ATTEMPTS = 32

type PendingCandidate = {
  connectionName: string
  route: HighDensityRoute
  key: string
  removedTransitionCount: number
  lengthSaved: number
}

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

export const hasSameIdentityAndTerminals = (
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
      structurallyEqual(baselineStart, candidateStart) &&
      structurallyEqual(baselineEnd, candidateEnd),
  )
}

/** Final, transactional via reduction after all DRC and pair post-processing. */
export class FinalViaOptimizationSolver extends BaseSolver {
  override getSolverName(): string {
    return "FinalViaOptimizationSolver"
  }

  hdRoutes: HighDensityRoute[]
  private readonly eligibleConnectionNames: string[]
  private readonly pendingCandidates: PendingCandidate[] = []
  private readonly acceptedRouteRescanQueue: string[] = []
  private readonly protectedConnectionNames: Set<string>
  private readonly obstacleSHI: ObstacleSpatialHashIndex
  private initialRouteScanIndex = 0
  private candidateEvaluations = 0
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
    this.eligibleConnectionNames = this.hdRoutes
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
      srj: input.originalSrj,
      convert: input.convert,
      productionDrcEvaluator: input.productionDrcEvaluator,
      relaxedDrcEvaluator: input.relaxedDrcEvaluator,
    })
    this.stats = {
      initialOutputViaCount: this.quality.outputViaCount,
      finalOutputViaCount: this.quality.outputViaCount,
      removedViaCount: 0,
      attemptedCandidateCount: 0,
      scannedEligibleRouteCount: 0,
      rescannedAcceptedRouteCount: 0,
      candidateEvaluationBudget: MAX_CANDIDATE_ATTEMPTS,
      candidateEvaluationCount: 0,
      acceptedCandidateCount: 0,
      rejectedByCollisionCount: 0,
      rejectedByConnectivityCount: 0,
      rejectedByMetadataCount: 0,
      rejectedByProductionDrcCount: 0,
      rejectedByRelaxedDrcCount: 0,
      rejectedByTraceLengthCount: 0,
    }
  }

  private scanRoute(connectionName: string, isRescan: boolean): void {
    const routeIndex = this.hdRoutes.findIndex(
      (route) => route.connectionName === connectionName,
    )
    if (routeIndex < 0)
      throw new Error(
        `FinalViaOptimizationSolver lost route "${connectionName}"`,
      )
    const route = this.hdRoutes[routeIndex]
    if (!route)
      throw new Error("FinalViaOptimizationSolver route index is invalid")
    const candidates = getSameLayerSpanCollapseCandidates({
      route: structuredClone(route),
      hdRouteSHI: new HighDensityRouteSpatialIndex(this.hdRoutes),
      obstacleSHI: this.obstacleSHI,
      connMap: this.input.connMap,
      outline: this.input.originalSrj.outline,
    })
    if (isRescan) this.stats.rescannedAcceptedRouteCount++
    else this.stats.scannedEligibleRouteCount++
    if (candidates.length === 0) {
      this.stats.rejectedByCollisionCount++
      return
    }
    for (const candidate of candidates) {
      const key = candidate.route.route
        .map((point) => `${point.x}:${point.y}:${point.z}`)
        .join("|")
      this.pendingCandidates.push({
        connectionName,
        route: candidate.route,
        key,
        removedTransitionCount: candidate.removedTransitionCount,
        lengthSaved: candidate.lengthSaved,
      })
    }
    this.pendingCandidates.sort((a, b) => {
      if (b.removedTransitionCount !== a.removedTransitionCount) {
        return b.removedTransitionCount - a.removedTransitionCount
      }
      if (b.lengthSaved !== a.lengthSaved) return b.lengthSaved - a.lengthSaved
      if (a.connectionName !== b.connectionName) {
        return a.connectionName.localeCompare(b.connectionName)
      }
      return a.key.localeCompare(b.key)
    })
  }

  private getCandidateRoutes(candidate: PendingCandidate): HighDensityRoute[] {
    const routeIndex = this.hdRoutes.findIndex(
      (route) => route.connectionName === candidate.connectionName,
    )
    if (routeIndex < 0)
      throw new Error(
        `FinalViaOptimizationSolver lost route "${candidate.connectionName}"`,
      )
    const routes = structuredClone(this.hdRoutes)
    routes[routeIndex] = structuredClone(candidate.route)
    return routes
  }

  private finish(): void {
    this.stats.finalOutputViaCount = this.quality.outputViaCount
    this.stats.removedViaCount =
      this.stats.initialOutputViaCount - this.quality.outputViaCount
    this.solved = true
  }

  private queueAcceptedRouteForRescan(connectionName: string): void {
    if (!this.acceptedRouteRescanQueue.includes(connectionName)) {
      this.acceptedRouteRescanQueue.push(connectionName)
    }
  }

  private removeStaleCandidates(connectionName: string): void {
    for (let index = this.pendingCandidates.length - 1; index >= 0; index--) {
      if (this.pendingCandidates[index]?.connectionName === connectionName) {
        this.pendingCandidates.splice(index, 1)
      }
    }
  }

  private getConvertedViaCount(routes: HighDensityRoute[]): number {
    return this.input
      .convert(routes)
      .reduce(
        (count, trace) =>
          count +
          trace.route.filter((segment) => segment.route_type === "via").length,
        0,
      )
  }

  private hasValidRollbackInvariant(
    candidateRoutes: HighDensityRoute[],
  ): boolean {
    if (candidateRoutes.length !== this.hdRoutes.length) return false
    return candidateRoutes.every((route, index) => {
      const acceptedRoute = this.hdRoutes[index]
      if (
        !acceptedRoute ||
        !hasSameIdentityAndTerminals(acceptedRoute, route)
      ) {
        return false
      }
      return (
        !isProtectedRoute(
          acceptedRoute,
          this.protectedConnectionNames,
          this.input.obstacles,
          this.input.connMap,
        ) || structurallyEqual(acceptedRoute, route)
      )
    })
  }

  _step(): void {
    if (this.initialRouteScanIndex < this.eligibleConnectionNames.length) {
      const connectionName =
        this.eligibleConnectionNames[this.initialRouteScanIndex++]!
      this.scanRoute(connectionName, false)
      return
    }
    if (this.pendingCandidates.length === 0) {
      const connectionName = this.acceptedRouteRescanQueue.shift()
      if (
        connectionName &&
        this.candidateEvaluations < MAX_CANDIDATE_ATTEMPTS
      ) {
        this.scanRoute(connectionName, true)
        return
      }
      this.finish()
      return
    }
    if (this.candidateEvaluations >= MAX_CANDIDATE_ATTEMPTS) {
      this.finish()
      return
    }

    const candidate = this.pendingCandidates.shift()!
    const candidateRoutes = this.getCandidateRoutes(candidate)
    if (!this.hasValidRollbackInvariant(candidateRoutes)) {
      this.stats.rejectedByConnectivityCount++
      return
    }

    this.candidateEvaluations++
    this.stats.candidateEvaluationCount++
    this.stats.attemptedCandidateCount++
    const convertedCandidateViaCount =
      this.getConvertedViaCount(candidateRoutes)
    if (convertedCandidateViaCount >= this.quality.outputViaCount) {
      this.stats.rejectedByMetadataCount++
      return
    }

    const candidateQuality = createRouteQualitySnapshot({
      hdRoutes: candidateRoutes,
      srj: this.input.originalSrj,
      convert: this.input.convert,
      productionDrcEvaluator: this.input.productionDrcEvaluator,
      relaxedDrcEvaluator: this.input.relaxedDrcEvaluator,
    })
    if (
      candidateQuality.productionDrcErrorCount >
        this.quality.productionDrcErrorCount ||
      (candidateQuality.productionDrcErrorCount ===
        this.quality.productionDrcErrorCount &&
        candidateQuality.productionDrcIssueScore >
          this.quality.productionDrcIssueScore)
    ) {
      this.stats.rejectedByProductionDrcCount++
      return
    }
    if (
      candidateQuality.relaxedDrcErrorCount > this.quality.relaxedDrcErrorCount
    ) {
      this.stats.rejectedByRelaxedDrcCount++
      return
    }
    if (candidateQuality.outputViaCount >= this.quality.outputViaCount) {
      this.stats.rejectedByMetadataCount++
      return
    }
    if (
      candidateQuality.totalTraceLength >
      this.quality.totalTraceLength + 1e-6
    ) {
      this.stats.rejectedByTraceLengthCount++
      return
    }

    this.hdRoutes = candidateRoutes
    this.quality = candidateQuality
    this.stats.acceptedCandidateCount++
    this.removeStaleCandidates(candidate.connectionName)
    this.queueAcceptedRouteForRescan(candidate.connectionName)
  }

  getOutput(): HighDensityRoute[] {
    if (!this.solved)
      throw new Error(
        "FinalViaOptimizationSolver output requested before solve",
      )
    return this.hdRoutes
  }
}
