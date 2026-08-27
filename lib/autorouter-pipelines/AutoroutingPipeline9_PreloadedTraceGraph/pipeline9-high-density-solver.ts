import {
  defaultB01Params,
  HighDensitySolverB01,
  type HighDensityObstacle,
  type HighDensityRectObstacle,
  type HighDensityRouteObstacle,
  type NodeWithPortPoints as B01NodeWithPortPoints,
} from "@tscircuit/high-density-b01"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import type { CapacityMeshNodeId } from "lib/types/capacity-mesh-types"
import type {
  HighDensityIntraNodeRoute,
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { BaseSolver } from "../../solvers/BaseSolver"
import { HighDensitySolver } from "../../solvers/HighDensitySolver/HighDensitySolver"
import type { PreloadedHighDensityRoute } from "./convert-preloaded-traces-to-hd-routes"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
  getPipeline9FixedRouteObstacles,
} from "./pipeline9-fixed-route-copper"
import {
  createRegionalFallbackProblem,
  type FixedRouteSection,
  spliceFixedRouteSectionWithMutationMask,
} from "./pipeline9-regional-fallback"
import { Pipeline9RegionalFallbackSolver } from "./pipeline9-regional-fallback-solver"

type Pipeline9HighDensitySolverParams = {
  nodePortPoints: NodeWithPortPoints[]
  fixedHdRoutes: PreloadedHighDensityRoute[]
  connMap: ConnectivityMap
  colorMap?: Record<string, string>
  obstacles: Obstacle[]
  layerCount: number
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  viaToPadClearance?: number
  effort: number
  nodePfById?:
    | Map<CapacityMeshNodeId, number | null>
    | Record<string, number | null>
  preserveTerminalPcbPortIds?: boolean
  includeBoardObstacles?: boolean
  enableRegionalFallback?: boolean
  maxB01Rips?: number
}

type NodeBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

const PRELOADED_TRACE_CLEARANCE = 0.15

const getNodeBounds = (
  node: NodeWithPortPoints,
  margin: number,
): NodeBounds => ({
  minX: node.center.x - node.width / 2 - margin,
  maxX: node.center.x + node.width / 2 + margin,
  minY: node.center.y - node.height / 2 - margin,
  maxY: node.center.y + node.height / 2 + margin,
})

const pointRadiusOverlapsNode = (
  point: { x: number; y: number },
  radius: number,
  nodeBounds: NodeBounds,
): boolean => {
  const dx = Math.max(nodeBounds.minX - point.x, 0, point.x - nodeBounds.maxX)
  const dy = Math.max(nodeBounds.minY - point.y, 0, point.y - nodeBounds.maxY)
  return dx * dx + dy * dy <= radius * radius
}

const segmentBoundsOverlapNode = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  radius: number,
  nodeBounds: NodeBounds,
): boolean =>
  Math.min(start.x, end.x) - radius <= nodeBounds.maxX &&
  Math.max(start.x, end.x) + radius >= nodeBounds.minX &&
  Math.min(start.y, end.y) - radius <= nodeBounds.maxY &&
  Math.max(start.y, end.y) + radius >= nodeBounds.minY

const routeOverlapsNode = (
  route: HighDensityRoute,
  node: NodeWithPortPoints,
  nodeBounds: NodeBounds,
  routedCopperRadius: number,
): boolean => {
  const availableZ = new Set(
    node.availableZ ?? node.portPoints.map((portPoint) => portPoint.z),
  )
  for (
    let routePointIndex = 1;
    routePointIndex < route.route.length;
    routePointIndex++
  ) {
    const start = route.route[routePointIndex - 1]!
    const end = route.route[routePointIndex]!
    if (start.z === end.z) {
      if (
        availableZ.has(start.z) &&
        segmentBoundsOverlapNode(
          start,
          end,
          route.traceThickness / 2 + routedCopperRadius,
          nodeBounds,
        )
      )
        return true
      continue
    }
    const minZ = Math.min(start.z, end.z)
    const maxZ = Math.max(start.z, end.z)
    if (
      [...availableZ].some((z) => z >= minZ && z <= maxZ) &&
      pointRadiusOverlapsNode(
        end,
        route.viaDiameter / 2 + routedCopperRadius,
        nodeBounds,
      )
    )
      return true
  }
  return false
}

const convertFixedRouteToB01Obstacles = (
  route: PreloadedHighDensityRoute,
  node: NodeWithPortPoints,
): HighDensityRouteObstacle[] => {
  const availableZ = new Set(
    node.availableZ ?? node.portPoints.map((portPoint) => portPoint.z),
  )
  if (availableZ.size === 0) {
    throw new Error(
      `Pipeline9 B01 node "${node.capacityMeshNodeId}" has no available layers`,
    )
  }

  const baseObstacle = {
    type: "route" as const,
    connectionName: route.connectionName,
    rootConnectionName: route.rootConnectionName,
    traceThickness: route.traceThickness,
    viaDiameter: route.viaDiameter,
  }
  const obstacles: HighDensityRouteObstacle[] = []
  for (
    let routePointIndex = 1;
    routePointIndex < route.route.length;
    routePointIndex++
  ) {
    const start = route.route[routePointIndex - 1]!
    const end = route.route[routePointIndex]!
    if (start.z === end.z) {
      if (!availableZ.has(start.z)) continue
      obstacles.push({ ...baseObstacle, route: [start, end], vias: [] })
      continue
    }
    const minZ = Math.min(start.z, end.z)
    const maxZ = Math.max(start.z, end.z)
    if (![...availableZ].some((z) => z >= minZ && z <= maxZ)) continue
    obstacles.push({
      ...baseObstacle,
      route: [start, end],
      vias: [
        {
          x: end.x,
          y: end.y,
          zStart: start.z,
          zEnd: end.z,
        },
      ],
    })
  }
  return obstacles
}

const obstacleOverlapsNode = (
  obstacle: Obstacle,
  nodeBounds: NodeBounds,
): boolean => {
  const rotationRadians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const cos = Math.abs(Math.cos(rotationRadians))
  const sin = Math.abs(Math.sin(rotationRadians))
  const rotatedHalfWidth =
    (obstacle.width / 2) * cos + (obstacle.height / 2) * sin
  const rotatedHalfHeight =
    (obstacle.width / 2) * sin + (obstacle.height / 2) * cos
  return (
    obstacle.center.x - rotatedHalfWidth <= nodeBounds.maxX &&
    obstacle.center.x + rotatedHalfWidth >= nodeBounds.minX &&
    obstacle.center.y - rotatedHalfHeight <= nodeBounds.maxY &&
    obstacle.center.y + rotatedHalfHeight >= nodeBounds.minY
  )
}

const convertObstacleToB01Obstacle = ({
  obstacle,
  node,
  connMap,
  layerCount,
}: {
  obstacle: Obstacle
  node: NodeWithPortPoints
  connMap: ConnectivityMap
  layerCount: number
}): HighDensityRectObstacle | undefined => {
  const availableZ = new Set(
    node.availableZ ?? node.portPoints.map((portPoint) => portPoint.z),
  )
  const zLayers = (
    obstacle.zLayers ??
    obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount))
  ).filter((z) => availableZ.has(z))
  if (zLayers.length === 0) return undefined
  const connectionName =
    obstacle.connectedTo[0] ??
    obstacle.obstacleId ??
    `pipeline9_obstacle_${obstacle.center.x}_${obstacle.center.y}`
  return {
    type: "rect",
    connectionName,
    rootConnectionName:
      connMap.getNetConnectedToId(connectionName) ?? connectionName,
    center: obstacle.center,
    width: obstacle.width,
    height: obstacle.height,
    ccwRotationDegrees: obstacle.ccwRotationDegrees,
    zLayers,
  }
}

const addTerminalPcbPortIds = (
  routes: HighDensityIntraNodeRoute[],
  node: NodeWithPortPoints,
): HighDensityIntraNodeRoute[] => {
  const terminalPortPoints = node.portPoints.filter(
    (portPoint) => portPoint.pcb_port_id !== undefined,
  )
  return routes.map((route) => {
    const start = route.route[0]
    const end = route.route.at(-1)
    const startTerminal = terminalPortPoints.find(
      (terminal) =>
        start !== undefined &&
        terminal.connectionName === route.connectionName &&
        terminal.x === start.x &&
        terminal.y === start.y &&
        terminal.z === start.z,
    )
    const endTerminal = terminalPortPoints.find(
      (terminal) =>
        end !== undefined &&
        terminal.connectionName === route.connectionName &&
        terminal.x === end.x &&
        terminal.y === end.y &&
        terminal.z === end.z,
    )

    return {
      ...route,
      startPcbPortId: startTerminal?.pcb_port_id,
      endPcbPortId: endTerminal?.pcb_port_id,
    }
  })
}

const normalizeNodeRootConnectionNames = (
  node: NodeWithPortPoints,
  connMap: ConnectivityMap,
): NodeWithPortPoints => {
  const normalizePortPoint = (
    portPoint: NodeWithPortPoints["portPoints"][number],
  ): NodeWithPortPoints["portPoints"][number] => ({
    ...portPoint,
    rootConnectionName:
      connMap.getNetConnectedToId(
        portPoint.rootConnectionName ?? portPoint.connectionName,
      ) ??
      portPoint.rootConnectionName ??
      portPoint.connectionName,
  })
  return {
    ...node,
    portPoints: node.portPoints.map(normalizePortPoint),
    portPointsInPairs: node.portPointsInPairs?.map(([start, end]) => [
      normalizePortPoint(start),
      normalizePortPoint(end),
    ]),
  }
}

const restoreRootConnectionNames = (
  routes: HighDensityIntraNodeRoute[],
  node: NodeWithPortPoints,
): HighDensityIntraNodeRoute[] =>
  routes.map((route) => ({
    ...route,
    rootConnectionName:
      node.portPoints.find(
        (portPoint) => portPoint.connectionName === route.connectionName,
      )?.rootConnectionName ?? route.rootConnectionName,
  }))

/**
 * Uses Pipeline7's detailed solver for ordinary nodes and B01 where local
 * preloaded copper must remain a layer-aware obstacle. If B01 cannot finish,
 * the regional adapter reroutes and splices only the intersecting preload.
 */
export class Pipeline9HighDensitySolver extends BaseSolver {
  readonly fixedHdRoutes: PreloadedHighDensityRoute[]
  readonly connMap: ConnectivityMap
  readonly colorMap: Record<string, string>
  readonly obstacles: Obstacle[]
  readonly layerCount: number
  readonly viaDiameter: number
  readonly traceWidth: number
  readonly obstacleMargin: number
  readonly viaToPadClearance?: number
  readonly effort: number
  readonly nodePfById: Map<CapacityMeshNodeId, number | null>
  readonly preserveTerminalPcbPortIds: boolean
  readonly includeBoardObstacles: boolean
  readonly enableRegionalFallback: boolean
  readonly maxB01Rips?: number
  readonly routes: HighDensityIntraNodeRoute[] = []
  readonly failedSolvers: HighDensitySolverB01[] = []
  readonly unsolvedNodePortPoints: NodeWithPortPoints[]
  readonly fixedRouteReplacements = new Map<string, PreloadedHighDensityRoute>()
  readonly removedFixedRouteConnectionNames = new Set<string>()
  readonly preloadedTraceMutationMasks = new Map<string, boolean[]>()

  activeRegularSolver: HighDensitySolver | null = null
  activeB01Solver: HighDensitySolverB01 | null = null
  activeFallbackSolver: Pipeline9RegionalFallbackSolver | null = null
  activeFallbackFixedRouteSections = new Map<string, FixedRouteSection>()
  activeFallbackFixedObstacleRoutes: PreloadedHighDensityRoute[] = []
  activeFallbackPromotedFixedRouteConnectionNames = new Set<string>()
  activeFallbackReason: string | null = null
  activeNode: NodeWithPortPoints | null = null

  constructor(params: Pipeline9HighDensitySolverParams) {
    super()
    this.fixedHdRoutes = params.fixedHdRoutes
    this.connMap = params.connMap
    this.colorMap = params.colorMap ?? {}
    this.obstacles = params.obstacles
    this.layerCount = params.layerCount
    this.viaDiameter = params.viaDiameter
    this.traceWidth = params.traceWidth
    this.obstacleMargin = params.obstacleMargin
    this.viaToPadClearance = params.viaToPadClearance
    this.effort = params.effort
    this.nodePfById =
      params.nodePfById instanceof Map
        ? new Map(params.nodePfById)
        : new Map(Object.entries(params.nodePfById ?? {}))
    this.preserveTerminalPcbPortIds = params.preserveTerminalPcbPortIds ?? false
    this.includeBoardObstacles = params.includeBoardObstacles ?? false
    this.enableRegionalFallback = params.enableRegionalFallback ?? true
    this.maxB01Rips = params.maxB01Rips
    this.unsolvedNodePortPoints = [...params.nodePortPoints]
    this.MAX_ITERATIONS = 100e6 * this.effort
    this.stats = {
      nodeCount: params.nodePortPoints.length,
      solvedNodeCount: 0,
      fixedObstacleCount: params.fixedHdRoutes.length,
      fixedObstacleUses: 0,
      boardObstacleUses: 0,
      fallbackNodeCount: 0,
      regularNodeCount: 0,
      b01NodeCount: 0,
      reroutedFixedRouteCount: 0,
      reroutedFixedRouteSectionCount: 0,
      promotedFallbackAttemptCount: 0,
      promotedFixedRouteCount: 0,
      regionalPreloadedViaCandidateRejectionCount: 0,
      regionalForceImproveCandidateRejectionCount: 0,
      regionalRepairCandidateRejectionCount: 0,
    }
  }

  override getSolverName(): string {
    return "Pipeline9HighDensitySolver"
  }

  getUpdatedFixedHdRoutes(): PreloadedHighDensityRoute[] {
    return this.fixedHdRoutes.flatMap((route) => {
      if (this.removedFixedRouteConnectionNames.has(route.connectionName)) {
        return []
      }
      return [this.fixedRouteReplacements.get(route.connectionName) ?? route]
    })
  }

  private finishActiveNode(routes: HighDensityIntraNodeRoute[]) {
    const solvedRoutes = this.activeNode
      ? restoreRootConnectionNames(routes, this.activeNode)
      : routes
    this.routes.push(
      ...(this.preserveTerminalPcbPortIds && this.activeNode
        ? addTerminalPcbPortIds(solvedRoutes, this.activeNode)
        : solvedRoutes),
    )
    this.stats.solvedNodeCount = Number(this.stats.solvedNodeCount ?? 0) + 1
    this.activeB01Solver = null
    this.activeRegularSolver = null
    this.activeFallbackSolver = null
    this.activeFallbackFixedRouteSections.clear()
    this.activeFallbackFixedObstacleRoutes = []
    this.activeFallbackPromotedFixedRouteConnectionNames.clear()
    this.activeFallbackReason = null
    this.activeNode = null
  }

  private startRegularSolver(node: NodeWithPortPoints): void {
    this.activeNode = node
    this.activeRegularSolver = new HighDensitySolver({
      nodePortPoints: [normalizeNodeRootConnectionNames(node, this.connMap)],
      colorMap: this.colorMap,
      connMap: this.connMap,
      viaDiameter: this.viaDiameter,
      traceWidth: this.traceWidth,
      obstacleMargin: this.obstacleMargin,
      effort: this.effort,
      nodePfById: this.nodePfById,
      obstacles: this.obstacles,
      layerCount: this.layerCount,
      useGrowShrinkHighDensityIntraNodeSolver: true,
      preserveTerminalPcbPortIds: false,
      growShrinkFallbackToInvalidGeometryOnFailure: false,
      captureSearchDebug: false,
    })
    this.stats.regularNodeCount = Number(this.stats.regularNodeCount ?? 0) + 1
  }

  private startRegionalFallback(
    promotedFixedRouteConnectionNames: ReadonlySet<string> = new Set(),
  ): void {
    if (!this.activeNode) {
      throw new Error(
        "Pipeline9 cannot start a regional fallback without an active node",
      )
    }

    const normalizedNode = normalizeNodeRootConnectionNames(
      this.activeNode,
      this.connMap,
    )
    const regionalNode = {
      ...normalizedNode,
      // The capacity path fixes each ordinary node to its assigned layers.
      // Once B01 has proved that assignment unroutable, the regional repair
      // must be able to add a legal layer transition; board obstacles still
      // constrain which of these layers it can actually use.
      availableZ: Array.from({ length: this.layerCount }, (_, z) => z),
    }
    const fallbackProblem = createRegionalFallbackProblem(
      regionalNode,
      this.getUpdatedFixedHdRoutes(),
      promotedFixedRouteConnectionNames,
    )
    const movableFixedRouteConnectionNames = new Set(
      [...fallbackProblem.fixedRouteSectionsByConnectionName.values()].flatMap(
        (section) => section.sourceRoutes.map((route) => route.connectionName),
      ),
    )
    for (const connectionName of promotedFixedRouteConnectionNames) {
      if (!movableFixedRouteConnectionNames.has(connectionName)) {
        throw new Error(
          `Pipeline9 could not promote fixed route "${connectionName}" into the active regional fallback`,
        )
      }
    }
    const newlyPromotedFixedRouteCount = [
      ...promotedFixedRouteConnectionNames,
    ].filter(
      (connectionName) =>
        !this.activeFallbackPromotedFixedRouteConnectionNames.has(
          connectionName,
        ),
    ).length
    this.activeFallbackFixedRouteSections =
      fallbackProblem.fixedRouteSectionsByConnectionName
    this.activeFallbackFixedObstacleRoutes = fallbackProblem.fixedObstacleRoutes
    this.activeFallbackPromotedFixedRouteConnectionNames = new Set(
      promotedFixedRouteConnectionNames,
    )
    const fixedRouteObstacles = getPipeline9FixedRouteObstacles({
      fixedObstacleRoutes: this.activeFallbackFixedObstacleRoutes,
      layerCount: this.layerCount,
    })
    this.activeFallbackSolver = new Pipeline9RegionalFallbackSolver({
      nodeWithPortPoints: fallbackProblem.nodeWithPortPoints,
      colorMap: this.colorMap,
      connMap: this.connMap,
      viaDiameter: this.viaDiameter,
      traceWidth: this.traceWidth,
      obstacleMargin: this.obstacleMargin,
      effort: this.effort,
      nodePfById: this.nodePfById,
      obstacles: [...this.obstacles, ...fixedRouteObstacles],
      boardObstacles: this.obstacles,
      movablePreloadedConnectionNames: movableFixedRouteConnectionNames,
      viaToPadClearance: this.viaToPadClearance,
      layerCount: this.layerCount,
    })
    if (promotedFixedRouteConnectionNames.size === 0) {
      this.stats.fallbackNodeCount =
        Number(this.stats.fallbackNodeCount ?? 0) + 1
    } else {
      this.stats.promotedFallbackAttemptCount =
        Number(this.stats.promotedFallbackAttemptCount ?? 0) + 1
      this.stats.promotedFixedRouteCount =
        Number(this.stats.promotedFixedRouteCount ?? 0) +
        newlyPromotedFixedRouteCount
    }
  }

  private finishRegionalFallback(): void {
    if (!this.activeFallbackSolver) return
    if (!this.activeNode) {
      throw new Error(
        "Pipeline9 cannot finish a regional fallback without an active node",
      )
    }

    this.recordRegionalCandidateRejections()

    const newRoutes: HighDensityIntraNodeRoute[] = []
    const replacementRoutesByConnectionName = new Map<
      string,
      HighDensityRoute[]
    >()

    for (const route of this.activeFallbackSolver.getOutput()) {
      if (!this.activeFallbackFixedRouteSections.has(route.connectionName)) {
        newRoutes.push(route)
        continue
      }
      const replacementRoutes =
        replacementRoutesByConnectionName.get(route.connectionName) ?? []
      replacementRoutes.push(route)
      replacementRoutesByConnectionName.set(
        route.connectionName,
        replacementRoutes,
      )
    }

    const pendingFixedRouteReplacements: Array<{
      connectionName: string
      section: FixedRouteSection
      replacement: PreloadedHighDensityRoute
      mutatedSegments: boolean[]
      replacementProducedSegment: boolean
    }> = []
    const unchangedFixedRouteSections: FixedRouteSection[] = []
    for (const [connectionName, section] of this
      .activeFallbackFixedRouteSections) {
      const replacementRoutes =
        replacementRoutesByConnectionName.get(connectionName) ?? []
      if (replacementRoutes.length === 0) {
        // Grid-based regional solvers can merge same-net sections that occupy
        // the same cells. Keep omitted fixed copper unchanged, then include it
        // in the conflict check below before accepting the candidate routes.
        unchangedFixedRouteSections.push(section)
        continue
      }
      if (replacementRoutes.length > 1) {
        this.error = `Pipeline9 regional fallback expected one replacement for fixed route "${connectionName}", got ${replacementRoutes.length}`
        this.failed = true
        return
      }
      const splicedRoute = spliceFixedRouteSectionWithMutationMask({
        section,
        replacement: replacementRoutes[0]!,
        sourceMutationMasks: this.preloadedTraceMutationMasks,
        replacementIsMutated: true,
      })
      pendingFixedRouteReplacements.push({
        connectionName,
        section,
        replacement: splicedRoute.route,
        mutatedSegments: splicedRoute.mutatedSegments,
        replacementProducedSegment: splicedRoute.replacementProducedSegment,
      })
    }

    const candidateRoutes: HighDensityRoute[] = [
      ...newRoutes,
      ...pendingFixedRouteReplacements.map(({ replacement }) => replacement),
    ]
    const fixedObstacleRoutes = [
      ...this.activeFallbackFixedObstacleRoutes,
      ...unchangedFixedRouteSections.flatMap((section) => section.sourceRoutes),
    ]
    const candidateBounds = getNodeBounds(
      this.activeNode,
      this.obstacleMargin + Math.max(this.traceWidth, this.viaDiameter) / 2,
    )
    const conflictingFixedRoutesByConnectionName = new Map<
      string,
      PreloadedHighDensityRoute
    >()
    for (const candidateRoute of candidateRoutes) {
      for (const fixedRoute of fixedObstacleRoutes) {
        if (
          arePipeline9RoutesOnSameNet(candidateRoute, fixedRoute, this.connMap)
        ) {
          continue
        }
        if (
          doPipeline9RoutesHaveCopperConflict({
            left: candidateRoute,
            right: fixedRoute,
            clearance: this.obstacleMargin,
            leftBounds: candidateBounds,
          })
        ) {
          conflictingFixedRoutesByConnectionName.set(
            fixedRoute.connectionName,
            fixedRoute,
          )
        }
      }
    }
    if (conflictingFixedRoutesByConnectionName.size > 0) {
      const conflictingConnectionNames = [
        ...conflictingFixedRoutesByConnectionName.keys(),
      ]
      const reconstructableConnectionNames = [
        ...conflictingFixedRoutesByConnectionName,
      ].flatMap(([connectionName, fixedRoute]) =>
        fixedRoute.isThroughObstacle === true ? [] : [connectionName],
      )
      // Moving one proven blocker can expose another. Grow only by exact
      // conflicts from the latest candidate, so the retry stays finite and
      // every other preload remains immutable. Component-owned through-
      // obstacle primitives are never movable.
      const promotedConnectionNames = new Set(
        this.activeFallbackPromotedFixedRouteConnectionNames,
      )
      for (const connectionName of reconstructableConnectionNames) {
        promotedConnectionNames.add(connectionName)
      }
      if (
        promotedConnectionNames.size ===
        this.activeFallbackPromotedFixedRouteConnectionNames.size
      ) {
        const immutableThroughObstacleConnectionNames = [
          ...conflictingFixedRoutesByConnectionName,
        ].flatMap(([connectionName, fixedRoute]) =>
          fixedRoute.isThroughObstacle === true ? [connectionName] : [],
        )
        this.error =
          immutableThroughObstacleConnectionNames.length > 0
            ? `Pipeline9 regional fallback conflicts with immutable through-obstacle route(s): ${immutableThroughObstacleConnectionNames.join(", ")}`
            : `Pipeline9 promoted regional fallback could not resolve immutable fixed route conflict(s): ${conflictingConnectionNames.join(", ")}`
        this.failed = true
        return
      }
      this.startRegionalFallback(promotedConnectionNames)
      return
    }

    const mutationRangeByTraceIndex = new Map<
      number,
      { start: number; end: number }
    >()
    for (const {
      section,
      replacementProducedSegment,
    } of pendingFixedRouteReplacements) {
      // A replacement whose two anchors are the same point can exactly delete
      // a hairpin without leaving any replacement copper. There is no local
      // segment or unchanged bridge to include in the simplification window.
      if (!replacementProducedSegment) continue
      for (const sourceRoute of section.sourceRoutes) {
        const routePositionStart = sourceRoute.preloadedRoutePositionStart
        const routePositionEnd = sourceRoute.preloadedRoutePositionEnd
        if (
          (routePositionStart === undefined) !==
          (routePositionEnd === undefined)
        ) {
          throw new Error(
            `Pipeline9 fixed route "${sourceRoute.connectionName}" has incomplete route-position metadata`,
          )
        }
        // Direct high-density callers may supply legacy fixed routes without
        // serialized positions. Their stable route index is the supported
        // ordering coordinate; full Pipeline9 inputs always carry positions.
        const rangeStart = Math.min(
          routePositionStart ?? sourceRoute.preloadedRouteIndex,
          routePositionEnd ?? sourceRoute.preloadedRouteIndex,
        )
        const rangeEnd = Math.max(
          routePositionStart ?? sourceRoute.preloadedRouteIndex,
          routePositionEnd ?? sourceRoute.preloadedRouteIndex,
        )
        const existingRange = mutationRangeByTraceIndex.get(
          sourceRoute.preloadedTraceIndex,
        )
        mutationRangeByTraceIndex.set(sourceRoute.preloadedTraceIndex, {
          start: Math.min(existingRange?.start ?? rangeStart, rangeStart),
          end: Math.max(existingRange?.end ?? rangeEnd, rangeEnd),
        })
      }
    }
    for (const {
      connectionName,
      section,
      replacement,
      mutatedSegments,
    } of pendingFixedRouteReplacements) {
      this.fixedRouteReplacements.set(connectionName, replacement)
      this.preloadedTraceMutationMasks.set(connectionName, mutatedSegments)
      for (const sourceRoute of section.sourceRoutes.slice(1)) {
        this.removedFixedRouteConnectionNames.add(sourceRoute.connectionName)
        this.preloadedTraceMutationMasks.delete(sourceRoute.connectionName)
      }
    }

    // Capture the accepted regional envelope immediately against the
    // post-splice geometry. Segment masks are carried by later splices, so a
    // future fallback never has to replay this node's now-stale bounds.
    const postSpliceProblem = createRegionalFallbackProblem(
      {
        ...normalizeNodeRootConnectionNames(this.activeNode, this.connMap),
        portPoints: [],
        portPointsInPairs: [],
        availableZ: Array.from({ length: this.layerCount }, (_, z) => z),
      },
      this.getUpdatedFixedHdRoutes(),
    )
    const markedTraceIndexes = new Set<number>()
    for (const section of postSpliceProblem.fixedRouteSectionsByConnectionName.values()) {
      const firstSourceRoute = section.sourceRoutes[0]
      if (!firstSourceRoute) continue
      const mutationRange = mutationRangeByTraceIndex.get(
        firstSourceRoute.preloadedTraceIndex,
      )
      if (!mutationRange) continue
      for (const [
        sourceRouteIndex,
        sourceRoute,
      ] of section.sourceRoutes.entries()) {
        const start =
          sourceRoute.preloadedRoutePositionStart ??
          sourceRoute.preloadedRouteIndex
        const end =
          sourceRoute.preloadedRoutePositionEnd ??
          sourceRoute.preloadedRouteIndex
        const sourceRange = {
          start: Math.min(start, end),
          end: Math.max(start, end),
        }
        const sourceIsPoint = sourceRange.start === sourceRange.end
        const mutationIsPoint = mutationRange.start === mutationRange.end
        const overlapsMutation =
          sourceIsPoint || mutationIsPoint
            ? sourceRange.start <= mutationRange.end &&
              mutationRange.start <= sourceRange.end
            : sourceRange.start < mutationRange.end &&
              mutationRange.start < sourceRange.end
        if (!overlapsMutation) continue
        markedTraceIndexes.add(firstSourceRoute.preloadedTraceIndex)
        const mask = [
          ...(this.preloadedTraceMutationMasks.get(
            sourceRoute.connectionName,
          ) ?? Array(sourceRoute.route.length - 1).fill(false)),
        ]
        if (mask.length !== sourceRoute.route.length - 1) {
          throw new Error(
            `Pipeline9 fixed route mutation mask for "${sourceRoute.connectionName}" has ${mask.length} segments, expected ${sourceRoute.route.length - 1}`,
          )
        }
        const firstSegmentIndex =
          sourceRouteIndex === 0 ? section.start.segmentIndex : 0
        const lastSegmentIndex =
          sourceRouteIndex === section.sourceRoutes.length - 1
            ? section.end.segmentIndex
            : sourceRoute.route.length - 2
        for (
          let segmentIndex = firstSegmentIndex;
          segmentIndex <= lastSegmentIndex;
          segmentIndex++
        ) {
          mask[segmentIndex] = true
        }
        this.preloadedTraceMutationMasks.set(sourceRoute.connectionName, mask)
      }
    }
    for (const preloadedTraceIndex of mutationRangeByTraceIndex.keys()) {
      if (!markedTraceIndexes.has(preloadedTraceIndex)) {
        throw new Error(
          `Pipeline9 could not capture accepted mutation provenance for trace ${preloadedTraceIndex}`,
        )
      }
    }

    const reroutedFixedRouteCount = pendingFixedRouteReplacements.reduce(
      (count, { section }) => count + section.sourceRoutes.length,
      0,
    )
    this.stats.reroutedFixedRouteCount =
      Number(this.stats.reroutedFixedRouteCount ?? 0) + reroutedFixedRouteCount
    this.stats.reroutedFixedRouteSectionCount =
      Number(this.stats.reroutedFixedRouteSectionCount ?? 0) +
      pendingFixedRouteReplacements.length
    this.finishActiveNode(newRoutes)
  }

  private recordRegionalCandidateRejections(): void {
    if (!this.activeFallbackSolver) return
    const regionalStats = this.activeFallbackSolver.stats
    this.stats.regionalPreloadedViaCandidateRejectionCount =
      Number(this.stats.regionalPreloadedViaCandidateRejectionCount ?? 0) +
      Number(regionalStats.preloadedViaCandidateRejectionCount ?? 0)
    this.stats.regionalForceImproveCandidateRejectionCount =
      Number(this.stats.regionalForceImproveCandidateRejectionCount ?? 0) +
      Number(regionalStats.forceImproveCandidateRejectionCount ?? 0)
    this.stats.regionalRepairCandidateRejectionCount =
      Number(this.stats.regionalRepairCandidateRejectionCount ?? 0) +
      Number(regionalStats.repairCandidateRejectionCount ?? 0)
  }

  override _step(): void {
    if (this.activeFallbackSolver) {
      this.activeFallbackSolver.step()
      if (this.activeFallbackSolver.failed) {
        this.recordRegionalCandidateRejections()
        this.error = [
          `Pipeline9 primary high-density routing failed: ${this.activeFallbackReason ?? "unknown error"}`,
          `regional fallback failed: ${this.activeFallbackSolver.error ?? "unknown error"}`,
        ].join("; ")
        this.failed = true
        this.activeFallbackSolver = null
        this.activeFallbackFixedRouteSections.clear()
        this.activeFallbackFixedObstacleRoutes = []
        this.activeFallbackPromotedFixedRouteConnectionNames.clear()
        this.activeNode = null
        return
      }
      if (!this.activeFallbackSolver.solved) return

      this.finishRegionalFallback()
      return
    }

    if (this.activeRegularSolver) {
      this.activeRegularSolver.step()
      if (this.activeRegularSolver.failed) {
        this.activeFallbackReason = `regular high-density routing failed: ${this.activeRegularSolver.error ?? "unknown error"}`
        this.activeRegularSolver = null
        if (!this.enableRegionalFallback) {
          this.error = `Pipeline9 ${this.activeFallbackReason}`
          this.failed = true
          this.activeNode = null
          return
        }
        this.startRegionalFallback()
        return
      }
      if (!this.activeRegularSolver.solved) return

      this.finishActiveNode(this.activeRegularSolver.routes)
      return
    }

    if (this.activeB01Solver) {
      this.activeB01Solver.step()
      if (this.activeB01Solver.failed) {
        this.failedSolvers.push(this.activeB01Solver)
        this.activeFallbackReason = `B01 failed: ${this.activeB01Solver.error ?? "unknown error"}`
        this.activeB01Solver = null
        if (!this.enableRegionalFallback) {
          this.error = `Pipeline9 ${this.activeFallbackReason}`
          this.failed = true
          this.activeNode = null
          return
        }
        this.startRegionalFallback()
        return
      }
      if (!this.activeB01Solver.solved) return

      this.finishActiveNode(this.activeB01Solver.getOutput())
      return
    }

    const node = this.unsolvedNodePortPoints.pop()
    if (!node) {
      this.solved = true
      return
    }

    const nodeBounds = getNodeBounds(node, this.obstacleMargin)
    const routedCopperRadius = Math.max(this.traceWidth, this.viaDiameter) / 2
    const fixedObstacles = this.getUpdatedFixedHdRoutes()
      .filter((route) =>
        routeOverlapsNode(route, node, nodeBounds, routedCopperRadius),
      )
      .flatMap((route) => convertFixedRouteToB01Obstacles(route, node))
    this.stats.fixedObstacleUses =
      Number(this.stats.fixedObstacleUses ?? 0) + fixedObstacles.length
    if (fixedObstacles.length === 0) {
      this.startRegularSolver(node)
      return
    }

    const boardObstacles = (this.includeBoardObstacles ? this.obstacles : [])
      .filter((obstacle) => obstacleOverlapsNode(obstacle, nodeBounds))
      .map((obstacle) =>
        convertObstacleToB01Obstacle({
          obstacle,
          node,
          connMap: this.connMap,
          layerCount: this.layerCount,
        }),
      )
      .filter(
        (obstacle): obstacle is HighDensityRectObstacle =>
          obstacle !== undefined,
      )
    this.stats.boardObstacleUses =
      Number(this.stats.boardObstacleUses ?? 0) + boardObstacles.length

    this.activeNode = node
    if (node.width > 15 || node.height > 15) {
      this.activeFallbackReason = `B01 node "${node.capacityMeshNodeId}" exceeds the 15x15mm routing limit (${node.width}x${node.height}mm)`
      this.startRegionalFallback()
      return
    }

    const normalizedNode = normalizeNodeRootConnectionNames(node, this.connMap)
    this.stats.b01NodeCount = Number(this.stats.b01NodeCount ?? 0) + 1
    this.activeB01Solver = new HighDensitySolverB01({
      ...defaultB01Params,
      nodeWithPortPoints: normalizedNode as B01NodeWithPortPoints,
      obstacles: [
        ...fixedObstacles,
        ...boardObstacles,
      ] as HighDensityObstacle[],
      viaDiameter: this.viaDiameter,
      viaMinDistFromBorder: this.viaDiameter / 2,
      traceThickness: this.traceWidth,
      traceMargin: this.obstacleMargin,
      obstacleClearanceMargin: PRELOADED_TRACE_CLEARANCE,
      effort: this.effort,
    })
    if (this.maxB01Rips !== undefined) {
      this.activeB01Solver.MAX_RIPS = this.maxB01Rips
    }
  }

  override visualize(): GraphicsObject {
    return (
      this.activeFallbackSolver?.visualize() ??
      this.activeRegularSolver?.visualize() ??
      this.activeB01Solver?.visualize() ?? {
        lines: this.routes.flatMap((route) =>
          route.route.slice(0, -1).map((point, pointIndex) => ({
            points: [point, route.route[pointIndex + 1]!],
            strokeWidth: route.traceThickness,
            layer: `z${point.z}`,
            label: route.connectionName,
          })),
        ),
        points: [],
        rects: [],
        circles: [],
      }
    )
  }
}
