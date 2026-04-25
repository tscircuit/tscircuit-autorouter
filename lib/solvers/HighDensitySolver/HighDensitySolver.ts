import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { doSegmentsIntersect } from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import type { CapacityMeshNodeId } from "lib/types/capacity-mesh-types"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { mergeRouteSegments } from "lib/utils/mergeRouteSegments"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import { createPairedConnectionNodeTransform } from "lib/utils/createPairedConnectionNodeTransform"
import { createNodeRectification } from "lib/utils/rectifyNodeWithPortPoints"
import { getNodeBounds } from "lib/utils/capacityMeshNodeGeometry"
import { BaseSolver } from "../BaseSolver"
import { HyperSingleIntraNodeSolver } from "../HyperHighDensitySolver/HyperSingleIntraNodeSolver"
import { safeTransparentize } from "../colors"
import { CachedIntraNodeRouteSolver } from "./CachedIntraNodeRouteSolver"
import { IntraNodeRouteSolver } from "./IntraNodeSolver"

export class HighDensitySolver extends BaseSolver {
  override getSolverName(): string {
    return "HighDensitySolver"
  }

  unsolvedNodePortPoints: NodeWithPortPoints[]
  routes: HighDensityIntraNodeRoute[]
  colorMap: Record<string, string>

  // Defaults as specified: viaDiameter of 0.3 and traceThickness of 0.15
  readonly defaultViaDiameter = 0.3
  readonly defaultTraceThickness = 0.15
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  effort: number

  failedSolvers: (IntraNodeRouteSolver | HyperSingleIntraNodeSolver)[]
  activeSubSolver: IntraNodeRouteSolver | HyperSingleIntraNodeSolver | null =
    null
  activeRouteRestorer:
    | ((route: HighDensityIntraNodeRoute) => HighDensityIntraNodeRoute)
    | null = null
  connMap?: ConnectivityMap
  nodePfById: Map<CapacityMeshNodeId, number | null>
  originalNodeById: Map<CapacityMeshNodeId, NodeWithPortPoints>
  nodeSolveMetadataById: Map<
    CapacityMeshNodeId,
    {
      node: NodeWithPortPoints
      status: "solved" | "failed"
      solverType: string
      iterations: number
      routeCount: number
      nodePf: number | null
      error?: string
    }
  >

  constructor({
    nodePortPoints,
    colorMap,
    connMap,
    viaDiameter,
    traceWidth,
    obstacleMargin,
    effort,
    nodePfById,
  }: {
    nodePortPoints: NodeWithPortPoints[]
    colorMap?: Record<string, string>
    connMap?: ConnectivityMap
    viaDiameter?: number
    traceWidth?: number
    obstacleMargin?: number
    effort?: number
    nodePfById?:
      | Map<CapacityMeshNodeId, number | null>
      | Record<string, number | null>
  }) {
    super()
    this.unsolvedNodePortPoints = nodePortPoints
    this.colorMap = colorMap ?? {}
    this.connMap = connMap
    this.routes = []
    this.failedSolvers = []
    this.effort = effort ?? 1
    this.MAX_ITERATIONS = 10e6 * this.effort
    this.viaDiameter = viaDiameter ?? this.defaultViaDiameter
    this.traceWidth = traceWidth ?? this.defaultTraceThickness
    this.obstacleMargin = obstacleMargin ?? 0.15
    this.nodePfById =
      nodePfById instanceof Map
        ? new Map(nodePfById)
        : new Map(Object.entries(nodePfById ?? {}))
    this.originalNodeById = new Map(
      nodePortPoints.map((node) => [node.capacityMeshNodeId, node]),
    )
    this.nodeSolveMetadataById = new Map()
    this.stats = {
      solverNodeCount: {} as Record<string, number>,
      difficultNodePfs: {} as Record<string, number[]>,
    }
  }

  private getSolvedNodeSolverType(
    solver: IntraNodeRouteSolver | HyperSingleIntraNodeSolver,
  ): string {
    if (solver instanceof HyperSingleIntraNodeSolver && solver.winningSolver) {
      return this.getConcreteSolverTypeName(solver.winningSolver as BaseSolver)
    }
    return this.getConcreteSolverTypeName(solver)
  }

  private recordNodeSolveMetadata(
    solver: IntraNodeRouteSolver | HyperSingleIntraNodeSolver,
    status: "solved" | "failed",
  ) {
    const node =
      this.originalNodeById.get(solver.nodeWithPortPoints.capacityMeshNodeId) ??
      solver.nodeWithPortPoints
    const nodePf = this.nodePfById.get(node.capacityMeshNodeId) ?? null
    this.nodeSolveMetadataById.set(node.capacityMeshNodeId, {
      node,
      status,
      solverType: this.getSolvedNodeSolverType(solver),
      iterations: solver.iterations,
      routeCount: solver.solvedRoutes.length,
      nodePf,
      error: solver.error ?? undefined,
    })
  }

  private createNodeMarkerLabel(
    capacityMeshNodeId: CapacityMeshNodeId,
    metadata: {
      status: "solved" | "failed"
      solverType: string
      iterations: number
      routeCount: number
      nodePf: number | null
      node: NodeWithPortPoints
      error?: string
    },
  ): string {
    return [
      `hd_node_marker`,
      `node: ${capacityMeshNodeId}`,
      `status: ${metadata.status}`,
      `solver: ${metadata.solverType}`,
      `iterations: ${metadata.iterations}`,
      `routes: ${metadata.routeCount}`,
      `nodePf: ${metadata.nodePf ?? "n/a"}`,
      `portPoints: ${metadata.node.portPoints.length}`,
      ...(metadata.error ? [`error: ${metadata.error}`] : []),
    ].join("\n")
  }

  private getConcreteSolverTypeName(solver: BaseSolver): string {
    if (solver instanceof CachedIntraNodeRouteSolver) {
      const concreteName = this.getIntraNodeStrategyName(solver.hyperParameters)
      return solver.cacheHit ? `${concreteName} [cached]` : concreteName
    }

    if (solver instanceof IntraNodeRouteSolver) {
      return this.getIntraNodeStrategyName(solver.hyperParameters)
    }

    return solver.getSolverName()
  }

  private getIntraNodeStrategyName(
    hyperParameters: Record<string, any> | undefined,
  ): string {
    if (hyperParameters?.MULTI_HEAD_POLYLINE_SOLVER) {
      return "MultiHeadPolyLineIntraNodeSolver3"
    }
    if (hyperParameters?.SINGLE_LAYER_NO_DIFFERENT_ROOT_INTERSECTIONS) {
      return "SingleLayerNoDifferentRootIntersectionsIntraNodeSolver"
    }
    if (hyperParameters?.CLOSED_FORM_SINGLE_TRANSITION) {
      return "SingleTransitionIntraNodeSolver"
    }
    if (hyperParameters?.CLOSED_FORM_TWO_TRACE_SAME_LAYER) {
      return "TwoCrossingRoutesHighDensitySolver"
    }
    if (hyperParameters?.CLOSED_FORM_TWO_TRACE_TRANSITION_CROSSING) {
      return "SingleTransitionCrossingRouteSolver"
    }
    if (hyperParameters?.FIXED_TOPOLOGY_HIGH_DENSITY_INTRA_NODE_SOLVER) {
      return "FixedTopologyHighDensityIntraNodeSolver"
    }
    if (hyperParameters?.HIGH_DENSITY_A01) {
      return "HighDensitySolverA01"
    }
    if (hyperParameters?.HIGH_DENSITY_A03) {
      return "HighDensitySolverA03"
    }
    return "SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
  }

  private recordSolvedNodeStats(
    solver: IntraNodeRouteSolver | HyperSingleIntraNodeSolver,
    node: NodeWithPortPoints,
  ) {
    const solverType = this.getSolvedNodeSolverType(solver)
    const solverNodeCount = this.stats.solverNodeCount as Record<string, number>
    const difficultNodePfs = this.stats.difficultNodePfs as Record<
      string,
      number[]
    >

    solverNodeCount[solverType] = (solverNodeCount[solverType] ?? 0) + 1

    const pf = this.nodePfById.get(node.capacityMeshNodeId) ?? null
    if (pf !== null && pf > 0.05) {
      if (!difficultNodePfs[solverType]) {
        difficultNodePfs[solverType] = []
      }
      difficultNodePfs[solverType].push(pf)
    }
  }

  private trySolveNodeWithDirectPairHeuristic(node: NodeWithPortPoints) {
    const pointsByConnection = new Map<
      string,
      NodeWithPortPoints["portPoints"]
    >()
    for (const portPoint of node.portPoints) {
      if (!pointsByConnection.has(portPoint.connectionName)) {
        pointsByConnection.set(portPoint.connectionName, [])
      }
      pointsByConnection.get(portPoint.connectionName)!.push(portPoint)
    }

    if (pointsByConnection.size === 0 || pointsByConnection.size > 8) {
      return null
    }

    const directRoutes: HighDensityIntraNodeRoute[] = []
    const routeSegments: Array<{
      connectionName: string
      rootConnectionName?: string
      z: number
      start: { x: number; y: number }
      end: { x: number; y: number }
    }> = []

    for (const [connectionName, points] of pointsByConnection) {
      if (points.length !== 2) {
        return null
      }

      const [A, B] = points
      if (!A || !B) return null

      let route: HighDensityIntraNodeRoute
      if (A.z === B.z) {
        route = {
          connectionName,
          rootConnectionName: A.rootConnectionName,
          traceThickness: this.traceWidth,
          viaDiameter: this.viaDiameter,
          route: [
            { x: A.x, y: A.y, z: A.z },
            { x: B.x, y: B.y, z: B.z },
          ],
          vias: [],
        }
        routeSegments.push({
          connectionName,
          rootConnectionName: A.rootConnectionName,
          z: A.z,
          start: { x: A.x, y: A.y },
          end: { x: B.x, y: B.y },
        })
      } else {
        const candidateRoutes: HighDensityIntraNodeRoute[] = []
        const midpointDistance = Math.hypot(A.x - B.x, A.y - B.y)
        if (midpointDistance <= this.viaDiameter) {
          const viaPoint = {
            x: (A.x + B.x) / 2,
            y: (A.y + B.y) / 2,
          }
          candidateRoutes.push({
            connectionName,
            rootConnectionName: A.rootConnectionName,
            traceThickness: this.traceWidth,
            viaDiameter: this.viaDiameter,
            route: [
              { x: A.x, y: A.y, z: A.z },
              { x: viaPoint.x, y: viaPoint.y, z: A.z },
              { x: viaPoint.x, y: viaPoint.y, z: B.z },
              { x: B.x, y: B.y, z: B.z },
            ].filter(
              (point, index, arr) =>
                index === 0 ||
                Math.abs(point.x - arr[index - 1]!.x) > 1e-6 ||
                Math.abs(point.y - arr[index - 1]!.y) > 1e-6 ||
                point.z !== arr[index - 1]!.z,
            ),
            vias: [{ x: viaPoint.x, y: viaPoint.y }],
          })
        }

        candidateRoutes.push(
          {
            connectionName,
            rootConnectionName: A.rootConnectionName,
            traceThickness: this.traceWidth,
            viaDiameter: this.viaDiameter,
            route: [
              { x: A.x, y: A.y, z: A.z },
              { x: A.x, y: A.y, z: B.z },
              { x: B.x, y: B.y, z: B.z },
            ],
            vias: [{ x: A.x, y: A.y }],
          },
          {
            connectionName,
            rootConnectionName: A.rootConnectionName,
            traceThickness: this.traceWidth,
            viaDiameter: this.viaDiameter,
            route: [
              { x: A.x, y: A.y, z: A.z },
              { x: B.x, y: B.y, z: A.z },
              { x: B.x, y: B.y, z: B.z },
            ],
            vias: [{ x: B.x, y: B.y }],
          },
        )

        const buildSegments = (candidateRoute: HighDensityIntraNodeRoute) =>
          candidateRoute.route.slice(1).flatMap((point, index) => {
            const prev = candidateRoute.route[index]!
            if (prev.z !== point.z) return []
            return [
              {
                connectionName,
                rootConnectionName: A.rootConnectionName,
                z: point.z,
                start: { x: prev.x, y: prev.y },
                end: { x: point.x, y: point.y },
              },
            ]
          })

        const selectedCandidate = candidateRoutes.find((candidateRoute) => {
          const candidateSegments = buildSegments(candidateRoute)
          return candidateSegments.every((newSegment) =>
            routeSegments.every((existingSegment) => {
              if (existingSegment.z !== newSegment.z) return true
              if (
                existingSegment.rootConnectionName &&
                newSegment.rootConnectionName &&
                this.connMap?.areIdsConnected(
                  existingSegment.rootConnectionName,
                  newSegment.rootConnectionName,
                )
              ) {
                return true
              }
              return !doSegmentsIntersect(
                existingSegment.start,
                existingSegment.end,
                newSegment.start,
                newSegment.end,
              )
            }),
          )
        })

        if (!selectedCandidate) {
          return null
        }

        route = selectedCandidate
        routeSegments.push(...buildSegments(selectedCandidate))
      }

      directRoutes.push(route)
    }

    return directRoutes
  }

  /**
   * Each iteration, pop an unsolved node and attempt to find the routes inside
   * of it.
   */
  _step() {
    this.updateCacheStats()
    if (this.activeSubSolver) {
      this.activeSubSolver.step()
      if (this.activeSubSolver.solved) {
        const solvedNodeId =
          this.activeSubSolver.nodeWithPortPoints.capacityMeshNodeId
        const originalNode = this.originalNodeById.get(solvedNodeId)
        const rectification = originalNode
          ? createNodeRectification(originalNode)
          : null

        this.routes.push(
          ...this.activeSubSolver.solvedRoutes.map((route) =>
            rectification
              ? rectification.reverseRoute(
                  this.activeRouteRestorer?.(route) ?? route,
                )
              : (this.activeRouteRestorer?.(route) ?? route),
          ),
        )
        this.recordNodeSolveMetadata(this.activeSubSolver, "solved")
        this.recordSolvedNodeStats(
          this.activeSubSolver,
          originalNode ?? this.activeSubSolver.nodeWithPortPoints,
        )
        this.activeSubSolver = null
        this.activeRouteRestorer = null
      } else if (this.activeSubSolver.failed) {
        this.recordNodeSolveMetadata(this.activeSubSolver, "failed")
        this.failedSolvers.push(this.activeSubSolver)
        this.activeSubSolver = null
        this.activeRouteRestorer = null
      }
      this.updateCacheStats()
      return
    }
    if (this.unsolvedNodePortPoints.length === 0) {
      if (this.failedSolvers.length > 0) {
        this.solved = false
        this.failed = true
        // debugger
        this.error = `Failed to solve ${this.failedSolvers.length} nodes, ${this.failedSolvers.slice(0, 5).map((fs) => fs.nodeWithPortPoints.capacityMeshNodeId)}. err0: ${this.failedSolvers[0].error}.`
        this.updateCacheStats()
        return
      }

      this.solved = true
      this.updateCacheStats()
      return
    }
    const node = this.unsolvedNodePortPoints.pop()!
    const rectification = createNodeRectification(node)
    const pairedConnectionTransform = createPairedConnectionNodeTransform(
      rectification.rectifiedNode,
    )
    this.activeRouteRestorer = pairedConnectionTransform.restoreRoute

    const directRoutes = this.trySolveNodeWithDirectPairHeuristic(
      pairedConnectionTransform.nodeWithPortPoints,
    )
    if (directRoutes) {
      const solvedNode =
        this.originalNodeById.get(node.capacityMeshNodeId) ?? node
      this.routes.push(
        ...directRoutes.map((route) =>
          rectification.reverseRoute(
            this.activeRouteRestorer?.(route) ?? route,
          ),
        ),
      )
      this.nodeSolveMetadataById.set(solvedNode.capacityMeshNodeId, {
        node: solvedNode,
        status: "solved",
        solverType: "DirectPairHeuristic",
        iterations: 0,
        routeCount: directRoutes.length,
        nodePf: this.nodePfById.get(solvedNode.capacityMeshNodeId) ?? null,
      })
      const solverNodeCount = this.stats.solverNodeCount as Record<
        string,
        number
      >
      solverNodeCount.DirectPairHeuristic =
        (solverNodeCount.DirectPairHeuristic ?? 0) + 1
      this.activeRouteRestorer = null
      return
    }

    this.activeSubSolver = new HyperSingleIntraNodeSolver({
      nodeWithPortPoints: pairedConnectionTransform.nodeWithPortPoints,
      colorMap: this.colorMap,
      connMap: this.connMap,
      viaDiameter: this.viaDiameter,
      traceWidth: this.traceWidth,
      obstacleMargin: this.obstacleMargin,
      effort: this.effort,
    })
    this.updateCacheStats()
  }

  private updateCacheStats() {
    const cacheProvider = getGlobalInMemoryCache()
    this.stats.intraNodeCacheHits = cacheProvider.cacheHits
    this.stats.intraNodeCacheMisses = cacheProvider.cacheMisses
  }

  visualize(): GraphicsObject {
    let graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }
    for (const route of this.routes) {
      // Merge segments based on z-coordinate
      const mergedSegments = mergeRouteSegments(
        route.route,
        route.connectionName,
        this.colorMap[route.connectionName],
      )

      // Add merged segments to graphics
      for (const segment of mergedSegments) {
        graphics.lines!.push({
          points: segment.points,
          label: segment.connectionName,
          strokeColor:
            segment.z === 0
              ? segment.color
              : safeTransparentize(segment.color, 0.5),
          layer: `z${segment.z}`,
          strokeWidth: route.traceThickness,
          strokeDash: segment.z !== 0 ? [0.1, 0.3] : undefined,
        })
      }
      for (const via of route.vias) {
        graphics.circles!.push({
          center: via,
          layer: "z0,1",
          radius: route.viaDiameter / 2,
          fill: this.colorMap[route.connectionName],
          label: `${route.connectionName} via`,
        })
      }
    }
    if (this.solved || this.failed) {
      for (const [capacityMeshNodeId, metadata] of this.nodeSolveMetadataById) {
        const bounds = getNodeBounds(metadata.node as any)

        const label = this.createNodeMarkerLabel(capacityMeshNodeId, metadata)
        const markerColor = metadata.status === "solved" ? "blue" : "red"

        if (metadata.node.polygon && metadata.node.polygon.length >= 3) {
          graphics.lines!.push({
            points: [...metadata.node.polygon, metadata.node.polygon[0]!],
            layer: "hd_node_boundaries",
            strokeColor: markerColor,
            strokeDash: "6, 4",
            strokeWidth: 0.03,
            label,
          })
        } else {
          graphics.lines!.push(
            {
              points: [
                { x: bounds.minX, y: bounds.minY },
                { x: bounds.maxX, y: bounds.minY },
              ],
              layer: "hd_node_boundaries",
              strokeColor: markerColor,
              strokeDash: "6, 4",
              strokeWidth: 0.03,
              label,
            },
            {
              points: [
                { x: bounds.maxX, y: bounds.minY },
                { x: bounds.maxX, y: bounds.maxY },
              ],
              layer: "hd_node_boundaries",
              strokeColor: markerColor,
              strokeDash: "6, 4",
              strokeWidth: 0.03,
              label,
            },
            {
              points: [
                { x: bounds.maxX, y: bounds.maxY },
                { x: bounds.minX, y: bounds.maxY },
              ],
              layer: "hd_node_boundaries",
              strokeColor: markerColor,
              strokeDash: "6, 4",
              strokeWidth: 0.03,
              label,
            },
            {
              points: [
                { x: bounds.minX, y: bounds.maxY },
                { x: bounds.minX, y: bounds.minY },
              ],
              layer: "hd_node_boundaries",
              strokeColor: markerColor,
              strokeDash: "6, 4",
              strokeWidth: 0.03,
              label,
            },
          )
        }

        if (metadata.status === "solved") {
          graphics.points!.push({
            x: metadata.node.center.x,
            y: metadata.node.center.y,
            color: markerColor,
            layer: "hd_node_markers",
            label,
          })
        } else {
          graphics.lines!.push({
            points: [
              { x: 0, y: 0 },
              {
                x: metadata.node.center.x,
                y: metadata.node.center.y,
              },
            ],
            layer: "hd_failed_node_guides",
            strokeColor: "red",
            strokeDash: "8, 6",
            strokeWidth: 0.05,
            label,
          })
          const rectWidth = Math.max(metadata.node.width * 0.1, 0.12)
          const rectHeight = Math.max(metadata.node.height * 0.1, 0.12)
          graphics.rects!.push({
            center: metadata.node.center,
            layer: "hd_node_markers",
            width: rectWidth,
            height: rectHeight,
            fill: "red",
            label,
          })
        }
      }
    }
    if (this.activeSubSolver) {
      graphics = combineVisualizations(
        graphics,
        this.activeSubSolver.visualize(),
      )
    }
    return graphics
  }
}
