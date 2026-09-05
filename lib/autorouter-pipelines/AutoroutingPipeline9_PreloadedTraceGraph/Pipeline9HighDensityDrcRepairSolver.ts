import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import type { DrcEvaluator } from "high-density-repair03/lib"
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
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { normalizePipeline9NodeRootConnectionNames } from "./Pipeline9HighDensitySolver"
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
  drcEvaluator: DrcEvaluator
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
 * high-density node boundaries. A node that participates in every repairable
 * DRC has only its DRC-participating connections routed again with the ordinary
 * high-density search. Other routes stay fixed as copper obstacles, and the
 * candidate is published only when it clears the repairable DRC set.
 */
export class Pipeline9HighDensityDrcRepairSolver extends BaseSolver {
  readonly params: Pipeline9HighDensityDrcRepairSolverParams
  readonly attemptedNodeIds = new Set<string>()
  outputHdRoutes: HighDensityRoute[]
  currentErrors: Pipeline9DrcError[]
  activeNode: NodeWithPortPoints | null = null
  override activeSubSolver: HighDensitySolver | null = null
  private initialized = false
  private activeConnectionNames = new Set<string>()
  private acceptedCandidate: AcceptedHighDensityCandidate | null = null
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
      acceptedNodeCount: 0,
      exhaustedNodeCount: 0,
      candidateAttemptCount: 0,
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
    if (!hasPotentialDrc) {
      this.solved = true
      return
    }
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

  private getAtomicCandidateNodeIds(): Set<string> {
    const routeIndexByTraceId = this.getRouteIndexByTraceId(this.outputHdRoutes)
    let candidateNodeIds: Set<string> | null = null
    for (const error of this.currentErrors) {
      const errorNodeIds = new Set<string>()
      for (const traceId of getPipeline9DrcErrorTraceIds(error)) {
        const routeIndex = routeIndexByTraceId.get(traceId)
        if (routeIndex === undefined) continue
        const regionId = this.outputHdRoutes[routeIndex]!.regionId
        if (regionId !== undefined) errorNodeIds.add(regionId)
      }
      if (candidateNodeIds === null) {
        candidateNodeIds = errorNodeIds
        continue
      }
      for (const nodeId of candidateNodeIds) {
        if (!errorNodeIds.has(nodeId)) candidateNodeIds.delete(nodeId)
      }
    }
    return candidateNodeIds ?? new Set<string>()
  }

  private getNextAffectedNode(): NodeWithPortPoints | undefined {
    const currentDrcNodeIds = this.getCurrentDrcNodeIds()
    const candidateNodeIds = this.getAtomicCandidateNodeIds()
    const knownNodeIds = new Set(
      this.params.nodePortPoints.map((node) => node.capacityMeshNodeId),
    )
    const missingNodeId = [...currentDrcNodeIds].find(
      (nodeId) => !knownNodeIds.has(nodeId),
    )
    if (missingNodeId) {
      throw new Error(
        `Pipeline9 cannot find high-density node "${missingNodeId}" selected for DRC repair`,
      )
    }
    return this.params.nodePortPoints.find(
      (node) =>
        candidateNodeIds.has(node.capacityMeshNodeId) &&
        !this.attemptedNodeIds.has(node.capacityMeshNodeId),
    )
  }

  private evaluateCandidateRoutes(
    candidateNodeRoutes: HighDensityRoute[],
    nodeId: string,
  ): boolean {
    this.stats.candidateAttemptCount =
      Number(this.stats.candidateAttemptCount ?? 0) + 1
    const candidateRoutes = replaceNodeRoutes({
      currentRoutes: this.outputHdRoutes,
      candidateRoutes: candidateNodeRoutes,
      nodeId,
      connectionNames: this.activeConnectionNames,
    })
    if (!candidateRoutes) return false
    const candidateErrors = this.getRepairableDrcErrors(candidateRoutes)
    if (
      candidateErrors.length > 0 ||
      !isPipeline9DrcCandidateBetter(candidateErrors, this.currentErrors)
    ) {
      return false
    }
    this.acceptedCandidate = {
      routes: candidateRoutes,
      errors: candidateErrors,
    }
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

  private getCandidateRoutes(
    candidateNodeRoutes: HighDensityRoute[],
    nodeId: string,
  ): HighDensityRoute[] | null {
    return replaceNodeRoutes({
      currentRoutes: this.outputHdRoutes,
      candidateRoutes: candidateNodeRoutes,
      nodeId,
      connectionNames: this.activeConnectionNames,
    })
  }

  private doesCandidateClearDrc(
    candidateNodeRoutes: HighDensityRoute[],
    nodeId: string,
  ): boolean {
    const candidateRoutes = this.getCandidateRoutes(candidateNodeRoutes, nodeId)
    return (
      candidateRoutes !== null &&
      this.getRepairableDrcErrors(candidateRoutes).length === 0
    )
  }

  private startNodeRepair(node: NodeWithPortPoints): void {
    this.activeNode = node
    this.acceptedCandidate = null
    this.activeConnectionNames = this.getDrcConnectionNamesForNode(
      node.capacityMeshNodeId,
    )
    if (this.activeConnectionNames.size === 0) {
      throw new Error(
        `Pipeline9 selected high-density node "${node.capacityMeshNodeId}" without a DRC-bearing connection`,
      )
    }
    this.attemptedNodeIds.add(node.capacityMeshNodeId)
    this.stats.attemptedNodeCount = this.attemptedNodeIds.size
    const repairNode = this.getRepairNode(node, this.activeConnectionNames)
    const fixedNodeRoutes = this.outputHdRoutes.filter(
      (route) =>
        route.regionId === node.capacityMeshNodeId &&
        !this.activeConnectionNames.has(route.connectionName),
    )
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
      obstacles: [
        ...this.params.obstacles,
        ...getPipeline9FixedRouteObstacles({
          fixedObstacleRoutes: [
            ...fixedNodeRoutes,
            ...this.params.fixedHdRoutes,
          ],
          layerCount: this.params.layerCount,
        }),
      ],
      layerCount: this.params.layerCount,
      useGrowShrinkHighDensityIntraNodeSolver: true,
      preserveTerminalPcbPortIds: true,
      growShrinkFallbackToInvalidGeometryOnFailure: false,
      growShrinkSolutionValidator: (routes) =>
        this.doesCandidateClearDrc(routes, node.capacityMeshNodeId),
      captureSearchDebug: false,
    })
  }

  private finishAcceptedNodeRepair(): void {
    if (!this.acceptedCandidate || !this.activeNode) {
      throw new Error(
        "Pipeline9 high-density DRC repair solver finished without an accepted candidate",
      )
    }
    this.outputHdRoutes = this.acceptedCandidate.routes
    this.currentErrors = this.acceptedCandidate.errors
    this.stats.acceptedNodeCount = Number(this.stats.acceptedNodeCount ?? 0) + 1
    this.stats.finalDrcIssueCount = this.currentErrors.length
    this.acceptedCandidate = null
    this.activeNode = null
    this.activeConnectionNames.clear()
    this.activeSubSolver = null
  }

  private finishExhaustedNodeRepair(error: string): void {
    this.stats.exhaustedNodeCount =
      Number(this.stats.exhaustedNodeCount ?? 0) + 1
    this.stats.lastExhaustedNodeError = error
    this.activeSubSolver = null
    this.activeNode = null
    this.activeConnectionNames.clear()
    this.acceptedCandidate = null
  }

  private finishRepairPass(): void {
    this.activeSubSolver = null
    this.activeNode = null
    this.activeConnectionNames.clear()
    this.acceptedCandidate = null
    this.stats.finalDrcIssueCount = this.currentErrors.length
    this.solved = true
  }

  override _step(): void {
    if (!this.initialized) {
      this.initializeDrcEvaluation()
      return
    }

    if (this.activeSubSolver) {
      this.activeSubSolver.step()
      if (this.activeSubSolver.solved) {
        if (!this.activeNode) {
          throw new Error(
            "Pipeline9 high-density DRC repair solved without an active node",
          )
        }
        const nodeId = this.activeNode.capacityMeshNodeId
        if (this.evaluateCandidateRoutes(this.activeSubSolver.routes, nodeId)) {
          this.finishAcceptedNodeRepair()
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

    if (
      ![...this.getAtomicCandidateNodeIds()].some(
        (nodeId) => !this.attemptedNodeIds.has(nodeId),
      )
    ) {
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
