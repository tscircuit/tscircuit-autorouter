import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import stableStringify from "fast-json-stable-stringify"
import type { GraphicsObject } from "graphics-debug"
import { getDrcScaledMaxIterations } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import { MIN_VIA_TO_VIA_CLEARANCE } from "lib/testing/getDrcErrors"
import type { CapacityMeshNodeId } from "lib/types/capacity-mesh-types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle, SimpleRouteConnection } from "lib/types/srj-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { normalizePipeline9NodeRootConnectionNames } from "./Pipeline9HighDensitySolver"
import type { Pipeline9HighDensityDrcEvaluator } from "./createPipeline9HighDensityDrcEvaluator"
import { getPipeline9HighDensityForceCandidates } from "./getPipeline9HighDensityForceCandidates"
import {
  getPipeline9HighDensitySeamForceCandidates,
  type Pipeline9HighDensitySeamForceCandidate,
} from "./getPipeline9HighDensitySeamForceCandidates"
import { isPipeline9HighDensityDrcCandidateBetter } from "./isPipeline9HighDensityDrcCandidateBetter"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9BoundsOverlap,
  doPipeline9RoutesHaveCopperConflict,
  getPipeline9FixedRouteObstacles,
  getPipeline9RouteCopperBounds,
  getPipeline9RouteCopperGeometry,
} from "./pipeline9FixedRouteCopper"
import {
  getPipeline9DrcErrors,
  getPipeline9DrcErrorTraceIds,
  getPipeline9RouteIndexByTraceId,
  isPipeline9DrcCandidateBetter,
  type Pipeline9DrcError,
} from "./pipeline9JointDrcRepairUtils"

export type Pipeline9HighDensityDrcRepairSolverParams = {
  nodePortPoints: NodeWithPortPoints[]
  hdRoutes: HighDensityRoute[]
  fixedHdRoutes: HighDensityRoute[]
  newConnections: SimpleRouteConnection[]
  drcEvaluator: Pipeline9HighDensityDrcEvaluator
  connMap: ConnectivityMap
  colorMap: Record<string, string>
  obstacles: Obstacle[]
  layerCount: number
  viaDiameter: number
  viaHoleDiameter: number
  traceWidth: number
  obstacleMargin: number
  drcClearance: number
  effort: number
  nodePfById?:
    | Map<CapacityMeshNodeId, number | null>
    | Record<string, number | null>
}

type AcceptedHighDensityCandidate = {
  routes: HighDensityRoute[]
  errors: Pipeline9DrcError[]
}

type AxisAlignedBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type DrilledVia = {
  x: number
  y: number
  holeDiameter: number
}

type NodeRepairBudget = {
  attempts: number
  maxAttempts: number
}

// @tscircuit/checks uses this tolerance both to identify coincident vias and
// when comparing drill-hole edge clearance for same-net and different-net vias.
const VIA_SPACING_EPSILON = 0.005

const doesSegmentIntersectBounds = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  bounds: AxisAlignedBounds,
): boolean => {
  let minT = 0
  let maxT = 1
  for (const axis of ["x", "y"] as const) {
    const delta = end[axis] - start[axis]
    const min = axis === "x" ? bounds.minX : bounds.minY
    const max = axis === "x" ? bounds.maxX : bounds.maxY
    if (Math.abs(delta) <= 1e-9) {
      if (start[axis] < min || start[axis] > max) return false
      continue
    }
    const firstT = (min - start[axis]) / delta
    const secondT = (max - start[axis]) / delta
    minT = Math.max(minT, Math.min(firstT, secondT))
    maxT = Math.min(maxT, Math.max(firstT, secondT))
    if (minT > maxT) return false
  }
  return true
}

const getObstacleBounds = (obstacle: Obstacle): AxisAlignedBounds => {
  const radians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const cosine = Math.abs(Math.cos(radians))
  const sine = Math.abs(Math.sin(radians))
  const halfWidth = (obstacle.width * cosine + obstacle.height * sine) / 2
  const halfHeight = (obstacle.width * sine + obstacle.height * cosine) / 2
  return {
    minX: obstacle.center.x - halfWidth,
    maxX: obstacle.center.x + halfWidth,
    minY: obstacle.center.y - halfHeight,
    maxY: obstacle.center.y + halfHeight,
  }
}

const getObstacleLocalPoint = (
  point: { x: number; y: number },
  obstacle: Obstacle,
): { x: number; y: number } => {
  const radians = (-(obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const offsetX = point.x - obstacle.center.x
  const offsetY = point.y - obstacle.center.y
  return {
    x: offsetX * Math.cos(radians) - offsetY * Math.sin(radians),
    y: offsetX * Math.sin(radians) + offsetY * Math.cos(radians),
  }
}

const getMinimumDistanceBetweenSegmentAndObstacle = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  obstacle: Obstacle,
): number => {
  const localStart = getObstacleLocalPoint(start, obstacle)
  const localEnd = getObstacleLocalPoint(end, obstacle)
  const halfWidth = obstacle.width / 2
  const halfHeight = obstacle.height / 2
  const bounds = {
    minX: -halfWidth,
    maxX: halfWidth,
    minY: -halfHeight,
    maxY: halfHeight,
  }
  if (doesSegmentIntersectBounds(localStart, localEnd, bounds)) return 0
  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ]
  return Math.min(
    ...corners.map((corner, cornerIndex) =>
      minimumDistanceBetweenSegments(
        localStart,
        localEnd,
        corner,
        corners[(cornerIndex + 1) % corners.length]!,
      ),
    ),
  )
}

const doesRouteConflictWithObstacle = ({
  route,
  obstacle,
  clearance,
}: {
  route: HighDensityRoute
  obstacle: Obstacle & { __zLayers: number[] }
  clearance: number
}): boolean => {
  const obstacleBounds = getObstacleBounds(obstacle)
  const routeBounds = getPipeline9RouteCopperBounds(route)
  if (
    !routeBounds ||
    !doPipeline9BoundsOverlap(routeBounds, {
      minX: obstacleBounds.minX - clearance,
      maxX: obstacleBounds.maxX + clearance,
      minY: obstacleBounds.minY - clearance,
      maxY: obstacleBounds.maxY + clearance,
    })
  ) {
    return false
  }
  const geometry = getPipeline9RouteCopperGeometry(route)
  for (const wire of geometry.wireSegments) {
    if (!obstacle.__zLayers.includes(wire.z)) continue
    if (
      getMinimumDistanceBetweenSegmentAndObstacle(
        wire.start,
        wire.end,
        obstacle,
      ) <
      wire.width / 2 + clearance
    ) {
      return true
    }
  }
  for (const via of geometry.viaSpans) {
    if (!obstacle.__zLayers.some((z) => z >= via.minZ && z <= via.maxZ)) {
      continue
    }
    const localVia = getObstacleLocalPoint(via.center, obstacle)
    const deltaX = Math.max(Math.abs(localVia.x) - obstacle.width / 2, 0)
    const deltaY = Math.max(Math.abs(localVia.y) - obstacle.height / 2, 0)
    if (Math.hypot(deltaX, deltaY) < via.diameter / 2 + clearance) {
      return true
    }
  }
  return false
}

const doRouteViasHaveCopperConflict = ({
  left,
  right,
  clearance,
  sameRoute = false,
}: {
  left: DrilledVia[]
  right: DrilledVia[]
  clearance: number
  sameRoute?: boolean
}): boolean => {
  for (let leftIndex = 0; leftIndex < left.length; leftIndex++) {
    const leftVia = left[leftIndex]!
    for (
      let rightIndex = sameRoute ? leftIndex + 1 : 0;
      rightIndex < right.length;
      rightIndex++
    ) {
      const rightVia = right[rightIndex]!
      const distance = Math.hypot(
        leftVia.x - rightVia.x,
        leftVia.y - rightVia.y,
      )
      if (distance <= VIA_SPACING_EPSILON) continue
      const gap =
        distance - leftVia.holeDiameter / 2 - rightVia.holeDiameter / 2
      if (gap + VIA_SPACING_EPSILON < clearance) {
        return true
      }
    }
  }
  return false
}

const replaceNodeRoutes = ({
  currentRoutes,
  candidateRoutes,
  nodeId,
  connectionNames,
}: {
  currentRoutes: HighDensityRoute[]
  candidateRoutes: HighDensityRoute[]
  nodeId: string
  connectionNames: ReadonlySet<string>
}): HighDensityRoute[] | null => {
  const candidatesByConnectionName = new Map<string, HighDensityRoute[]>()
  for (const candidateRoute of candidateRoutes) {
    const routes =
      candidatesByConnectionName.get(candidateRoute.connectionName) ?? []
    routes.push(candidateRoute)
    candidatesByConnectionName.set(candidateRoute.connectionName, routes)
  }

  const replacedRoutes: HighDensityRoute[] = []
  for (const currentRoute of currentRoutes) {
    if (
      currentRoute.regionId !== nodeId ||
      !connectionNames.has(currentRoute.connectionName)
    ) {
      replacedRoutes.push(currentRoute)
      continue
    }
    const candidates = candidatesByConnectionName.get(
      currentRoute.connectionName,
    )
    const candidate = candidates?.shift()
    if (!candidate) return null
    replacedRoutes.push({
      ...candidate,
      rootConnectionName: currentRoute.rootConnectionName,
      regionId: nodeId,
    })
  }

  // A node can include preloaded pseudo-connections that this stage does not
  // own. Reject a candidate that rerouted them because projecting only part of
  // that solution would change the geometry the other routes were solved
  // against and can regress the later global repair stages.
  if (
    [...candidatesByConnectionName.values()].some((routes) => routes.length > 0)
  ) {
    return null
  }
  return replacedRoutes
}

/**
 * Repairs Pipeline9 DRCs while the route fragments still retain their
 * high-density node boundaries. Each affected node has its DRC-participating
 * connections repaired while other routes stay fixed as copper obstacles.
 * Accepted improvements become the incumbent for the next repair, including
 * when independent DRCs remain in other nodes.
 */
export class Pipeline9HighDensityDrcRepairSolver extends BaseSolver {
  readonly params: Pipeline9HighDensityDrcRepairSolverParams
  readonly attemptedNodeIds = new Set<string>()
  private readonly attemptedNodeIdsAtCurrentRevision = new Set<string>()
  private readonly acceptedNodeIds = new Set<string>()
  private readonly nodeRepairBudgets = new Map<string, NodeRepairBudget>()
  private nodePortPoints: NodeWithPortPoints[]
  outputHdRoutes: HighDensityRoute[]
  currentErrors: Pipeline9DrcError[]
  activeNode: NodeWithPortPoints | null = null
  override activeSubSolver: HighDensitySolver | null = null
  private initialized = false
  private activeConnectionNames = new Set<string>()
  private acceptedCandidate: AcceptedHighDensityCandidate | null = null
  private acceptedCandidateGeometryKey: string | null = null
  private activeForceCandidates: Generator<
    HighDensityRoute[],
    void,
    unknown
  > | null = null
  private activeRepairObstacles: Obstacle[] = []
  private activeSeamForceCandidates: Generator<
    Pipeline9HighDensitySeamForceCandidate,
    void,
    unknown
  > | null = null
  private readonly activeCandidateGeometryKeys = new Set<string>()
  private readonly drilledViasByRoute = new WeakMap<
    HighDensityRoute,
    DrilledVia[]
  >()
  private readonly fixedDrilledViasByRoute = new WeakMap<
    HighDensityRoute,
    DrilledVia[]
  >()
  private readonly connectionsByName: Map<string, SimpleRouteConnection>

  constructor(params: Pipeline9HighDensityDrcRepairSolverParams) {
    super()
    this.params = params
    this.nodePortPoints = params.nodePortPoints
    this.connectionsByName = new Map(
      params.newConnections.map((connection) => [connection.name, connection]),
    )
    // Keep the incumbent by reference until an accepted repair exists. Most
    // boards have no pre-stitch DRC, so cloning every route here needlessly
    // retains a second full geometry graph through the expensive later stages.
    this.outputHdRoutes = params.hdRoutes
    this.currentErrors = []
    this.MAX_ITERATIONS =
      Math.max(1, params.nodePortPoints.length) * 100e6 * params.effort
    this.stats = {
      initialDrcIssueCount: 0,
      finalDrcIssueCount: 0,
      drcNodeCount: 0,
      drcPrecheckFoundPotentialIssue: false,
      attemptedNodeCount: 0,
      nodeRepairAttemptCount: 0,
      acceptedNodeCount: 0,
      acceptedRepairCount: 0,
      acceptedForceRepairCount: 0,
      acceptedSeamForceRepairCount: 0,
      acceptedRerouteRepairCount: 0,
      forceCandidateAttemptCount: 0,
      seamForceCandidateAttemptCount: 0,
      forceNoMotionCount: 0,
      forceAnchorRejectedCount: 0,
      forceGeometryRejectedCount: 0,
      exhaustedNodeCount: 0,
      candidateAttemptCount: 0,
      unchangedCandidateCount: 0,
      duplicateCandidateCount: 0,
      localCandidateEvaluationCount: 0,
      fullCandidateEvaluationCount: 0,
      localCandidateEvaluationTimeMs: 0,
      snapshotPreparationTimeMs: 0,
      scopedCopperCheckTimeMs: 0,
      fullCandidateEvaluationTimeMs: 0,
      forceGenerationTimeMs: 0,
      seamForceGenerationTimeMs: 0,
      rerouteStepTimeMs: 0,
      budgetExhaustedNodeCount: 0,
    }
  }

  override getConstructorParams(): readonly [
    Pipeline9HighDensityDrcRepairSolverParams,
  ] {
    const constructorParams = this.params
    return [constructorParams] as const
  }

  private getRouteIndexByTraceId(
    routes: HighDensityRoute[],
  ): Map<string, number> {
    return getPipeline9RouteIndexByTraceId({
      routes,
      newConnections: this.params.newConnections,
      syntheticConnectionNames: new Set<string>(),
    })
  }

  private getRepairableDrcErrors(
    routes: HighDensityRoute[],
  ): Pipeline9DrcError[] {
    const routeIndexByTraceId = this.getRouteIndexByTraceId(routes)
    return getPipeline9DrcErrors(this.params.drcEvaluator, routes).filter(
      (error) =>
        getPipeline9DrcErrorTraceIds(error).some((traceId) =>
          routeIndexByTraceId.has(traceId),
        ),
    )
  }

  private hasPotentialHighDensityDrc(): boolean {
    const clearance = this.params.drcClearance
    for (
      let leftIndex = 0;
      leftIndex < this.outputHdRoutes.length;
      leftIndex++
    ) {
      const left = this.outputHdRoutes[leftIndex]!
      const leftVias = this.getDrilledVias(left)
      if (
        doRouteViasHaveCopperConflict({
          left: leftVias,
          right: leftVias,
          clearance: MIN_VIA_TO_VIA_CLEARANCE,
          sameRoute: true,
        })
      ) {
        return true
      }
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < this.outputHdRoutes.length;
        rightIndex++
      ) {
        const right = this.outputHdRoutes[rightIndex]!
        if (
          doRouteViasHaveCopperConflict({
            left: leftVias,
            right: this.getDrilledVias(right),
            clearance: MIN_VIA_TO_VIA_CLEARANCE,
          })
        ) {
          return true
        }
        if (arePipeline9RoutesOnSameNet(left, right, this.params.connMap)) {
          continue
        }
        if (
          doPipeline9RoutesHaveCopperConflict({
            left,
            right,
            clearance,
          })
        ) {
          return true
        }
      }
      for (const fixedRoute of this.params.fixedHdRoutes) {
        if (
          doRouteViasHaveCopperConflict({
            left: leftVias,
            right: this.getDrilledVias(fixedRoute, true),
            clearance: MIN_VIA_TO_VIA_CLEARANCE,
          })
        ) {
          return true
        }
        if (
          arePipeline9RoutesOnSameNet(left, fixedRoute, this.params.connMap)
        ) {
          continue
        }
        if (
          doPipeline9RoutesHaveCopperConflict({
            left,
            right: fixedRoute,
            clearance,
          })
        ) {
          return true
        }
      }
    }

    const layeredObstacles = createObjectsWithZLayers(
      this.params.obstacles,
      this.params.layerCount,
    )
    return this.outputHdRoutes.some((route) =>
      layeredObstacles.some(
        (obstacle) =>
          !isObstacleConnectedToRoute(obstacle, route, this.params.connMap) &&
          doesRouteConflictWithObstacle({ route, obstacle, clearance }),
      ),
    )
  }

  private getDrilledVias(
    route: HighDensityRoute,
    isFixedRoute = false,
  ): DrilledVia[] {
    const cache = isFixedRoute
      ? this.fixedDrilledViasByRoute
      : this.drilledViasByRoute
    const cachedVias = cache.get(route)
    if (cachedVias) return cachedVias
    const connectionPoints = this.connectionsByName.get(
      route.connectionName,
    )?.pointsToConnect
    if (
      route.vias.length === 0 &&
      !connectionPoints?.some(
        (point) => "terminalVia" in point && point.terminalVia,
      )
    ) {
      const vias: DrilledVia[] = []
      cache.set(route, vias)
      return vias
    }
    // Preloaded HD routes do not retain their original drill diameter. Their
    // outer diameter bounds it conservatively; the official evaluator still
    // checks the exact serialized drill before any repair is attempted.
    const viaHoleDiameter = isFixedRoute
      ? route.viaDiameter
      : this.params.viaHoleDiameter
    const vias = convertHdRouteToSimplifiedRoute(
      route,
      this.params.layerCount,
      {
        connectionPoints,
        defaultViaHoleDiameter: viaHoleDiameter,
        obstacles: this.params.obstacles,
        connMap: this.params.connMap,
      },
    ).flatMap((segment): DrilledVia[] =>
      segment.route_type === "via"
        ? [
            {
              x: segment.x,
              y: segment.y,
              holeDiameter: segment.via_hole_diameter ?? viaHoleDiameter,
            },
          ]
        : [],
    )
    cache.set(route, vias)
    return vias
  }

  private initializeDrcEvaluation(): void {
    this.initialized = true
    const hasPotentialDrc = this.hasPotentialHighDensityDrc()
    this.stats.drcPrecheckFoundPotentialIssue = hasPotentialDrc
    // Routing aliases and reconstructed copper can differ from the final DRC
    // identities. The geometric precheck is diagnostic, never proof that the
    // owned copper is clean; only the official evaluator can establish that.
    this.currentErrors = this.getRepairableDrcErrors(this.outputHdRoutes)
    this.stats.initialDrcIssueCount = this.currentErrors.length
    this.stats.finalDrcIssueCount = this.currentErrors.length
    this.stats.drcNodeCount = this.getCurrentDrcNodeIds().size
    if (this.currentErrors.length === 0) this.solved = true
  }

  private getCurrentDrcNodeIds(): Set<string> {
    const routeIndexByTraceId = this.getRouteIndexByTraceId(this.outputHdRoutes)
    const nodeIds = new Set<string>()
    for (const error of this.currentErrors) {
      for (const traceId of getPipeline9DrcErrorTraceIds(error)) {
        const routeIndex = routeIndexByTraceId.get(traceId)
        if (routeIndex === undefined) continue
        const route = this.outputHdRoutes[routeIndex]!
        if (!route.regionId) {
          throw new Error(
            `Pipeline9 high-density route "${route.connectionName}" has no regionId during DRC repair`,
          )
        }
        nodeIds.add(route.regionId)
      }
    }
    return nodeIds
  }

  private getNextAffectedNode(): NodeWithPortPoints | undefined {
    const currentDrcNodeIds = this.getCurrentDrcNodeIds()
    const knownNodeIds = new Set(
      this.nodePortPoints.map((node) => node.capacityMeshNodeId),
    )
    const missingNodeId = [...currentDrcNodeIds].find(
      (nodeId) => !knownNodeIds.has(nodeId),
    )
    if (missingNodeId) {
      throw new Error(
        `Pipeline9 cannot find high-density node "${missingNodeId}" selected for DRC repair`,
      )
    }
    return this.nodePortPoints.find((node) => {
      const budget = this.nodeRepairBudgets.get(node.capacityMeshNodeId)
      return (
        currentDrcNodeIds.has(node.capacityMeshNodeId) &&
        !this.attemptedNodeIdsAtCurrentRevision.has(node.capacityMeshNodeId) &&
        (budget === undefined || budget.attempts < budget.maxAttempts)
      )
    })
  }

  private evaluateCandidateRoutes(
    candidateNodeRoutes: HighDensityRoute[],
    nodeId: string,
  ): boolean {
    const candidateRoutes = replaceNodeRoutes({
      currentRoutes: this.outputHdRoutes,
      candidateRoutes: candidateNodeRoutes,
      nodeId,
      connectionNames: this.activeConnectionNames,
    })
    if (!candidateRoutes) return false
    return this.evaluateCandidateBoardRoutes(
      candidateRoutes,
      JSON.stringify(["node", nodeId, candidateNodeRoutes]),
    )
  }

  private evaluateCandidateBoardRoutes(
    candidateRoutes: HighDensityRoute[],
    candidateKey: string,
  ): boolean {
    this.stats.candidateAttemptCount =
      Number(this.stats.candidateAttemptCount ?? 0) + 1
    // An ordinary node reroute can reproduce the incumbent after an accepted
    // revision. Its new object identities do not make it new copper: the same
    // serialized routes cannot improve any official DRC score.
    if (
      candidateRoutes.length === this.outputHdRoutes.length &&
      candidateRoutes.every(
        (route, index) =>
          route === this.outputHdRoutes[index] ||
          stableStringify(route) ===
            stableStringify(this.outputHdRoutes[index]),
      )
    ) {
      this.stats.unchangedCandidateCount =
        Number(this.stats.unchangedCandidateCount) + 1
      return false
    }
    if (this.activeCandidateGeometryKeys.has(candidateKey)) {
      this.stats.duplicateCandidateCount =
        Number(this.stats.duplicateCandidateCount) + 1
      return (
        this.acceptedCandidate !== null &&
        this.acceptedCandidateGeometryKey === candidateKey
      )
    }
    this.activeCandidateGeometryKeys.add(candidateKey)
    const routeIndexByTraceId = this.getRouteIndexByTraceId(candidateRoutes)
    const evaluateLocalCandidate =
      this.params.drcEvaluator.evaluateLocalCandidate
    if (evaluateLocalCandidate) {
      const changedTraceIds = new Set(
        [...routeIndexByTraceId].flatMap(([traceId, routeIndex]) =>
          this.outputHdRoutes[routeIndex] === candidateRoutes[routeIndex]
            ? []
            : [traceId],
        ),
      )
      const localEvaluationStartedAt = performance.now()
      const local = evaluateLocalCandidate({
        currentRoutes: this.outputHdRoutes,
        candidateRoutes,
        changedTraceIds,
      })
      this.stats.localCandidateEvaluationTimeMs =
        Number(this.stats.localCandidateEvaluationTimeMs) +
        performance.now() -
        localEvaluationStartedAt
      this.stats.snapshotPreparationTimeMs =
        Number(this.stats.snapshotPreparationTimeMs) +
        (local.snapshotPreparationTimeMs ?? 0)
      this.stats.scopedCopperCheckTimeMs =
        Number(this.stats.scopedCopperCheckTimeMs) +
        (local.scopedCopperCheckTimeMs ?? 0)
      this.stats.localCandidateEvaluationCount =
        Number(this.stats.localCandidateEvaluationCount) + 1
      const isOwnedError = (error: Pipeline9DrcError): boolean =>
        getPipeline9DrcErrorTraceIds(error).some((traceId) =>
          routeIndexByTraceId.has(traceId),
        )
      const localCandidateErrors = local.candidateErrors.filter(isOwnedError)
      if (
        !isPipeline9DrcCandidateBetter(
          localCandidateErrors,
          local.currentErrors.filter(isOwnedError),
        ) ||
        // With unambiguous official deduplication keys, scoped pair counts
        // and nonnegative severity are lower bounds on the full candidate.
        // Compare against the FULL incumbent: a via owner can have remote
        // conflicts that are absent from the scoped baseline.
        (local.candidateErrorPairsAreUnambiguous &&
          !isPipeline9HighDensityDrcCandidateBetter(
            localCandidateErrors,
            this.currentErrors,
          ))
      ) {
        return false
      }
    }
    this.stats.fullCandidateEvaluationCount =
      Number(this.stats.fullCandidateEvaluationCount) + 1
    const fullEvaluationStartedAt = performance.now()
    const candidateErrors = this.getRepairableDrcErrors(candidateRoutes)
    this.stats.fullCandidateEvaluationTimeMs =
      Number(this.stats.fullCandidateEvaluationTimeMs) +
      performance.now() -
      fullEvaluationStartedAt
    if (
      !isPipeline9HighDensityDrcCandidateBetter(
        candidateErrors,
        this.currentErrors,
      )
    ) {
      return false
    }
    this.acceptedCandidate = {
      routes: candidateRoutes,
      errors: candidateErrors,
    }
    this.acceptedCandidateGeometryKey = candidateKey
    return true
  }

  private getDrcConnectionNamesForNode(nodeId: string): Set<string> {
    const routeIndexByTraceId = this.getRouteIndexByTraceId(this.outputHdRoutes)
    const connectionNames = new Set<string>()
    for (const error of this.currentErrors) {
      for (const traceId of getPipeline9DrcErrorTraceIds(error)) {
        const routeIndex = routeIndexByTraceId.get(traceId)
        if (routeIndex === undefined) continue
        const route = this.outputHdRoutes[routeIndex]!
        if (route.regionId === nodeId) {
          connectionNames.add(route.connectionName)
        }
      }
    }
    return connectionNames
  }

  private getRepairNode(
    node: NodeWithPortPoints,
    connectionNames: ReadonlySet<string>,
  ): NodeWithPortPoints {
    return {
      ...node,
      portPoints: node.portPoints.filter((portPoint) =>
        connectionNames.has(portPoint.connectionName),
      ),
      portPointsInPairs: node.portPointsInPairs?.filter(
        ([start, end]) =>
          connectionNames.has(start.connectionName) &&
          connectionNames.has(end.connectionName),
      ),
    }
  }

  private startNodeRepair(node: NodeWithPortPoints): void {
    this.activeNode = node
    this.activeCandidateGeometryKeys.clear()
    this.acceptedCandidate = null
    this.acceptedCandidateGeometryKey = null
    this.activeConnectionNames = this.getDrcConnectionNamesForNode(
      node.capacityMeshNodeId,
    )
    if (this.activeConnectionNames.size === 0) {
      throw new Error(
        `Pipeline9 selected high-density node "${node.capacityMeshNodeId}" without a DRC-bearing connection`,
      )
    }
    this.attemptedNodeIds.add(node.capacityMeshNodeId)
    this.attemptedNodeIdsAtCurrentRevision.add(node.capacityMeshNodeId)
    this.stats.attemptedNodeCount = this.attemptedNodeIds.size
    this.stats.nodeRepairAttemptCount =
      Number(this.stats.nodeRepairAttemptCount) + 1
    this.activeRepairObstacles = this.getNodeRepairObstacles(node)
    const localRouteIndexByGlobalIndex = new Map<number, number>()
    const localRoutes: HighDensityRoute[] = []
    for (const [routeIndex, route] of this.outputHdRoutes.entries()) {
      if (
        route.regionId !== node.capacityMeshNodeId ||
        !this.activeConnectionNames.has(route.connectionName)
      ) {
        continue
      }
      localRouteIndexByGlobalIndex.set(routeIndex, localRoutes.length)
      localRoutes.push(route)
    }
    const traceRouteIndexById = new Map<string, number>()
    for (const [traceId, globalIndex] of this.getRouteIndexByTraceId(
      this.outputHdRoutes,
    )) {
      const localIndex = localRouteIndexByGlobalIndex.get(globalIndex)
      if (localIndex !== undefined) traceRouteIndexById.set(traceId, localIndex)
    }
    const nodeErrors = this.currentErrors.filter((error) =>
      getPipeline9DrcErrorTraceIds(error).some((traceId) =>
        traceRouteIndexById.has(traceId),
      ),
    )
    let budget = this.nodeRepairBudgets.get(node.capacityMeshNodeId)
    if (budget === undefined) {
      // Reuse Repair03's effort/initial-DRC search budget for this HD region.
      // Tiny severity improvements must not turn a local repair into an
      // unbounded optimization loop. The budget is fixed on the first visit.
      budget = {
        attempts: 0,
        maxAttempts: getDrcScaledMaxIterations(
          nodeErrors.length,
          this.params.effort,
        ),
      }
      this.nodeRepairBudgets.set(node.capacityMeshNodeId, budget)
    }
    budget.attempts++
    this.activeForceCandidates = getPipeline9HighDensityForceCandidates({
      node,
      hdRoutes: localRoutes,
      errors: nodeErrors,
      traceRouteIndexById,
      // Fixed-route rectangles guide rerouting, but are not movable PCB pads.
      // Every force candidate still undergoes exact fixed-copper validation.
      obstacles: this.params.obstacles,
      layerCount: this.params.layerCount,
      viaDiameter: this.params.viaDiameter,
      viaHoleDiameter: this.params.viaHoleDiameter,
      traceWidth: this.params.traceWidth,
      obstacleMargin: this.params.obstacleMargin,
      connMap: this.params.connMap,
      forceContext: this.params.drcEvaluator.getForceContext(
        this.outputHdRoutes,
      ),
      effort: this.params.effort,
      onCandidateRejected: (reason): void => {
        const statName = {
          "no-motion": "forceNoMotionCount",
          anchor: "forceAnchorRejectedCount",
          geometry: "forceGeometryRejectedCount",
        }[reason]
        this.stats[statName] = Number(this.stats[statName]) + 1
      },
    })
    this.activeSeamForceCandidates = this.getSeamForceCandidates(node)
  }

  private *getSeamForceCandidates(
    node: NodeWithPortPoints,
  ): Generator<Pipeline9HighDensitySeamForceCandidate, void, unknown> {
    const traceRouteIndexById = this.getRouteIndexByTraceId(this.outputHdRoutes)
    for (const [affectedRouteIndex, route] of this.outputHdRoutes.entries()) {
      if (
        route.regionId !== node.capacityMeshNodeId ||
        !this.activeConnectionNames.has(route.connectionName)
      ) {
        continue
      }
      yield* getPipeline9HighDensitySeamForceCandidates({
        affectedRouteIndex,
        nodePortPoints: this.nodePortPoints,
        hdRoutes: this.outputHdRoutes,
        fixedHdRoutes: this.params.fixedHdRoutes,
        traceRouteIndexById,
        errors: this.currentErrors,
        obstacles: this.params.obstacles,
        layerCount: this.params.layerCount,
        viaDiameter: this.params.viaDiameter,
        viaHoleDiameter: this.params.viaHoleDiameter,
        traceWidth: this.params.traceWidth,
        obstacleMargin: this.params.obstacleMargin,
        connMap: this.params.connMap,
        forceContext: this.params.drcEvaluator.getForceContext(
          this.outputHdRoutes,
        ),
        effort: this.params.effort,
      })
    }
  }

  private acceptSeamForceCandidate(
    candidate: Pipeline9HighDensitySeamForceCandidate,
  ): void {
    const { seam } = candidate
    const updatePoint = (
      point: NodeWithPortPoints["portPoints"][number],
    ): NodeWithPortPoints["portPoints"][number] => {
      if (
        point.portPointId !== seam.portPointId ||
        point.connectionName !== seam.connectionName
      ) {
        return point
      }
      return { ...point, x: seam.x, y: seam.y, z: seam.z }
    }
    // Copy only accepted handoff metadata. Caller-owned nodes and routes stay
    // immutable, and subsequent node reroutes use both ends of the new seam.
    this.nodePortPoints = this.nodePortPoints.map(
      (node): NodeWithPortPoints => {
        if (!seam.ownerNodeIds.includes(node.capacityMeshNodeId)) return node
        return {
          ...node,
          portPoints: node.portPoints.map(updatePoint),
          portPointsInPairs: node.portPointsInPairs?.map(([start, end]) => [
            updatePoint(start),
            updatePoint(end),
          ]),
        }
      },
    )
    for (const nodeId of seam.ownerNodeIds) {
      this.acceptedNodeIds.add(nodeId)
    }
    this.finishAcceptedNodeRepair("seam")
  }

  private getNodeRepairObstacles(node: NodeWithPortPoints): Obstacle[] {
    const padding = this.params.viaDiameter / 2 + this.params.obstacleMargin
    const nativeBounds = getBoundsFromNodeWithPortPoints(node)
    const bounds = {
      minX: nativeBounds.minX - padding,
      maxX: nativeBounds.maxX + padding,
      minY: nativeBounds.minY - padding,
      maxY: nativeBounds.maxY + padding,
    }
    const immutableRoutes = [
      ...this.outputHdRoutes.filter(
        (route) =>
          route.regionId !== node.capacityMeshNodeId ||
          !this.activeConnectionNames.has(route.connectionName),
      ),
      ...this.params.fixedHdRoutes,
    ].filter((route) => {
      const copperBounds = getPipeline9RouteCopperBounds(route)
      return (
        copperBounds !== undefined &&
        doPipeline9BoundsOverlap(bounds, copperBounds)
      )
    })
    return [
      ...this.params.obstacles,
      ...getPipeline9FixedRouteObstacles({
        fixedObstacleRoutes: immutableRoutes,
        layerCount: this.params.layerCount,
      }),
    ]
  }

  private startNodeReroute(node: NodeWithPortPoints): void {
    const repairNode = this.getRepairNode(node, this.activeConnectionNames)
    this.activeSubSolver = new HighDensitySolver({
      nodePortPoints: [
        normalizePipeline9NodeRootConnectionNames(
          repairNode,
          this.params.connMap,
        ),
      ],
      colorMap: this.params.colorMap,
      connMap: this.params.connMap,
      viaDiameter: this.params.viaDiameter,
      traceWidth: this.params.traceWidth,
      obstacleMargin: this.params.obstacleMargin,
      effort: this.params.effort,
      nodePfById: this.params.nodePfById,
      obstacles: this.activeRepairObstacles,
      layerCount: this.params.layerCount,
      useGrowShrinkHighDensityIntraNodeSolver: true,
      preserveTerminalPcbPortIds: true,
      growShrinkFallbackToInvalidGeometryOnFailure: false,
      growShrinkSolutionValidator: (routes) =>
        this.evaluateCandidateRoutes(routes, node.capacityMeshNodeId),
      captureSearchDebug: false,
    })
  }

  private finishAcceptedNodeRepair(source: "force" | "seam" | "reroute"): void {
    if (!this.acceptedCandidate || !this.activeNode) {
      throw new Error(
        "Pipeline9 high-density DRC repair solver finished without an accepted candidate",
      )
    }
    this.invalidateChangedNodeContexts(this.acceptedCandidate.routes)
    this.outputHdRoutes = this.acceptedCandidate.routes
    this.currentErrors = this.acceptedCandidate.errors
    this.acceptedNodeIds.add(this.activeNode.capacityMeshNodeId)
    this.stats.acceptedNodeCount = this.acceptedNodeIds.size
    this.stats.acceptedRepairCount = Number(this.stats.acceptedRepairCount) + 1
    const sourceStat =
      source === "reroute"
        ? "acceptedRerouteRepairCount"
        : "acceptedForceRepairCount"
    this.stats[sourceStat] = Number(this.stats[sourceStat]) + 1
    if (source === "seam") {
      this.stats.acceptedSeamForceRepairCount =
        Number(this.stats.acceptedSeamForceRepairCount) + 1
    }
    this.stats.finalDrcIssueCount = this.currentErrors.length
    this.acceptedCandidate = null
    this.activeNode = null
    this.activeConnectionNames.clear()
    this.activeSubSolver = null
    this.activeForceCandidates = null
    this.activeSeamForceCandidates = null
    this.activeRepairObstacles = []
  }

  private invalidateChangedNodeContexts(nextRoutes: HighDensityRoute[]): void {
    const copperRadius = this.outputHdRoutes.reduce(
      (radius, route) =>
        Math.max(
          radius,
          route.viaDiameter / 2,
          route.traceThickness / 2,
          ...route.route.map((point) => (point.traceThickness ?? 0) / 2),
        ),
      Math.max(
        this.params.viaDiameter / 2,
        this.params.traceWidth / 2,
        ...this.params.newConnections.flatMap((connection) =>
          connection.pointsToConnect.map((point) =>
            "terminalVia" in point
              ? (point.terminalVia?.viaDiameter ?? 0) / 2
              : 0,
          ),
        ),
      ),
    )
    const changedBounds = this.outputHdRoutes.flatMap((route, index) => {
      const nextRoute = nextRoutes[index]!
      if (route === nextRoute) return []
      return [route, nextRoute].flatMap((changedRoute) => {
        const bounds = getPipeline9RouteCopperBounds(changedRoute)
        return [
          ...(bounds ? [bounds] : []),
          ...this.getDrilledVias(changedRoute).map((via) => ({
            minX: via.x - copperRadius,
            maxX: via.x + copperRadius,
            minY: via.y - copperRadius,
            maxY: via.y + copperRadius,
          })),
        ]
      })
    })
    const padding =
      copperRadius +
      Math.max(
        this.params.obstacleMargin,
        this.params.drcClearance,
        MIN_VIA_TO_VIA_CLEARANCE,
      )
    const knownNodeIds = new Set(
      this.params.nodePortPoints.map((node) => node.capacityMeshNodeId),
    )
    const drillBoundsByNodeId = new Map<string, AxisAlignedBounds>()
    // Serialized terminal vias can sit slightly beyond the HD endpoint.
    // Group their actual drill sites once instead of rescanning every route
    // for each node whose repair context may need to be invalidated.
    for (const route of this.outputHdRoutes) {
      if (route.regionId === undefined || !knownNodeIds.has(route.regionId)) {
        continue
      }
      for (const via of this.getDrilledVias(route)) {
        const bounds = drillBoundsByNodeId.get(route.regionId)
        if (bounds) {
          bounds.minX = Math.min(bounds.minX, via.x - padding)
          bounds.maxX = Math.max(bounds.maxX, via.x + padding)
          bounds.minY = Math.min(bounds.minY, via.y - padding)
          bounds.maxY = Math.max(bounds.maxY, via.y + padding)
        } else {
          drillBoundsByNodeId.set(route.regionId, {
            minX: via.x - padding,
            maxX: via.x + padding,
            minY: via.y - padding,
            maxY: via.y + padding,
          })
        }
      }
    }
    // A distant repair cannot change this node's geometry, obstacle context or
    // pairwise copper violations. Retry only nodes whose possible copper can
    // interact with an old or new changed fragment, including cross-layer drills.
    for (const node of this.nodePortPoints) {
      const nativeBounds = getBoundsFromNodeWithPortPoints(node)
      const bounds = {
        minX: nativeBounds.minX - padding,
        maxX: nativeBounds.maxX + padding,
        minY: nativeBounds.minY - padding,
        maxY: nativeBounds.maxY + padding,
      }
      const drillBounds = drillBoundsByNodeId.get(node.capacityMeshNodeId)
      if (drillBounds) {
        bounds.minX = Math.min(bounds.minX, drillBounds.minX)
        bounds.maxX = Math.max(bounds.maxX, drillBounds.maxX)
        bounds.minY = Math.min(bounds.minY, drillBounds.minY)
        bounds.maxY = Math.max(bounds.maxY, drillBounds.maxY)
      }
      if (
        node.capacityMeshNodeId === this.activeNode!.capacityMeshNodeId ||
        changedBounds.some((changed) =>
          doPipeline9BoundsOverlap(bounds, changed),
        )
      ) {
        this.attemptedNodeIdsAtCurrentRevision.delete(node.capacityMeshNodeId)
      }
    }
  }

  private finishExhaustedNodeRepair(error: string): void {
    this.stats.exhaustedNodeCount =
      Number(this.stats.exhaustedNodeCount ?? 0) + 1
    this.stats.lastExhaustedNodeError = error
    this.activeSubSolver = null
    this.activeNode = null
    this.activeConnectionNames.clear()
    this.acceptedCandidate = null
    this.activeForceCandidates = null
    this.activeSeamForceCandidates = null
    this.activeRepairObstacles = []
  }

  private finishRepairPass(): void {
    this.activeSubSolver = null
    this.activeNode = null
    this.activeConnectionNames.clear()
    this.acceptedCandidate = null
    this.activeForceCandidates = null
    this.activeSeamForceCandidates = null
    this.activeRepairObstacles = []
    this.stats.finalDrcIssueCount = this.currentErrors.length
    this.stats.budgetExhaustedNodeCount = [
      ...this.getCurrentDrcNodeIds(),
    ].filter((nodeId) => {
      const budget = this.nodeRepairBudgets.get(nodeId)
      return budget !== undefined && budget.attempts >= budget.maxAttempts
    }).length
    this.solved = true
  }

  override _step(): void {
    if (!this.initialized) {
      this.initializeDrcEvaluation()
      return
    }

    if (this.activeForceCandidates) {
      if (!this.activeNode) {
        throw new Error("Pipeline9 high-density forces require an active node")
      }
      const forceStartedAt = performance.now()
      const candidate = this.activeForceCandidates.next()
      this.stats.forceGenerationTimeMs =
        Number(this.stats.forceGenerationTimeMs) +
        performance.now() -
        forceStartedAt
      if (candidate.done) {
        this.activeForceCandidates = null
        return
      }
      this.stats.forceCandidateAttemptCount =
        Number(this.stats.forceCandidateAttemptCount) + 1
      if (
        this.evaluateCandidateRoutes(
          candidate.value,
          this.activeNode.capacityMeshNodeId,
        )
      ) {
        this.finishAcceptedNodeRepair("force")
      }
      return
    }

    if (this.activeSeamForceCandidates) {
      if (!this.activeNode) {
        throw new Error("Pipeline9 seam forces require an active node")
      }
      const seamStartedAt = performance.now()
      const candidate = this.activeSeamForceCandidates.next()
      this.stats.seamForceGenerationTimeMs =
        Number(this.stats.seamForceGenerationTimeMs) +
        performance.now() -
        seamStartedAt
      if (candidate.done) {
        this.activeSeamForceCandidates = null
        this.startNodeReroute(this.activeNode)
        return
      }
      this.stats.seamForceCandidateAttemptCount =
        Number(this.stats.seamForceCandidateAttemptCount) + 1
      const candidateRoutes = [...this.outputHdRoutes]
      for (const { routeIndex, route } of candidate.value.replacements) {
        candidateRoutes[routeIndex] = route
      }
      if (
        this.evaluateCandidateBoardRoutes(
          candidateRoutes,
          JSON.stringify(["seam", candidate.value.replacements]),
        )
      ) {
        this.acceptSeamForceCandidate(candidate.value)
      }
      return
    }

    if (this.activeSubSolver) {
      const rerouteStartedAt = performance.now()
      this.activeSubSolver.step()
      // Includes validator callbacks; evaluation counters above separate their
      // cost from the total ordinary high-density reroute step time.
      this.stats.rerouteStepTimeMs =
        Number(this.stats.rerouteStepTimeMs) +
        performance.now() -
        rerouteStartedAt
      if (this.activeSubSolver.solved) {
        if (!this.activeNode) {
          throw new Error(
            "Pipeline9 high-density DRC repair solved without an active node",
          )
        }
        const nodeId = this.activeNode.capacityMeshNodeId
        if (this.evaluateCandidateRoutes(this.activeSubSolver.routes, nodeId)) {
          this.finishAcceptedNodeRepair("reroute")
          return
        }
        this.finishExhaustedNodeRepair(
          `Ordinary high-density reroute did not improve DRCs for node "${nodeId}"`,
        )
        return
      }
      if (!this.activeSubSolver.failed) return
      // Like Repair03, this is best-effort optimization: an ordinary
      // high-density reroute can be unavailable even though the incumbent is
      // a complete route. Keep that incumbent and try another affected node.
      this.finishExhaustedNodeRepair(
        this.activeSubSolver.error ??
          `Ordinary high-density reroute failed for node "${this.activeNode?.capacityMeshNodeId}"`,
      )
      return
    }

    if (this.currentErrors.length === 0) {
      this.finishRepairPass()
      return
    }

    const nextNode = this.getNextAffectedNode()
    if (nextNode) {
      this.startNodeRepair(nextNode)
      return
    }
    this.finishRepairPass()
  }

  getOutput(): HighDensityRoute[] {
    if (this.failed) {
      throw new Error(this.error ?? "Pipeline9 high-density DRC repair failed")
    }
    if (!this.solved) {
      throw new Error("Pipeline9 high-density DRC repair has not completed")
    }
    return this.outputHdRoutes
  }

  override visualize(): GraphicsObject {
    if (this.activeSubSolver) return this.activeSubSolver.visualize()
    return {
      title: "Pipeline9 High Density DRC Repair",
      lines: this.outputHdRoutes.flatMap((route) =>
        route.route.slice(0, -1).flatMap((point, pointIndex) => {
          const nextPoint = route.route[pointIndex + 1]!
          if (point.z !== nextPoint.z) return []
          return [
            {
              points: [point, nextPoint],
              strokeColor: this.params.colorMap[route.connectionName],
              strokeWidth: route.traceThickness,
              layer: `z${point.z}`,
              label: route.connectionName,
            },
          ]
        }),
      ),
    }
  }
}
