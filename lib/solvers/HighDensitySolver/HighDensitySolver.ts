import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import type { CapacityMeshNodeId } from "lib/types/capacity-mesh-types"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { mergeRouteSegments } from "lib/utils/mergeRouteSegments"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../types/high-density-types"
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
  effort: number

  failedSolvers: (IntraNodeRouteSolver | HyperSingleIntraNodeSolver)[]
  activeSubSolver: IntraNodeRouteSolver | HyperSingleIntraNodeSolver | null =
    null
  connMap?: ConnectivityMap
  nodePfById: Map<CapacityMeshNodeId, number | null>
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
    effort,
    nodePfById,
  }: {
    nodePortPoints: NodeWithPortPoints[]
    colorMap?: Record<string, string>
    connMap?: ConnectivityMap
    viaDiameter?: number
    traceWidth?: number
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
    this.nodePfById =
      nodePfById instanceof Map
        ? new Map(nodePfById)
        : new Map(Object.entries(nodePfById ?? {}))
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
    const node = solver.nodeWithPortPoints
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
    const connectionNames = Array.from(
      new Set(metadata.node.portPoints.map((p) => p.connectionName)),
    )
    return [
      `hd_node_marker`,
      `node: ${capacityMeshNodeId}`,
      `status: ${metadata.status}`,
      `solver: ${metadata.solverType}`,
      `iterations: ${metadata.iterations}`,
      `routes: ${metadata.routeCount}`,
      `nodePf: ${metadata.nodePf ?? "n/a"}`,
      `portPoints: ${metadata.node.portPoints.length}`,
      `connections: ${connectionNames.join(", ")}`,
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

  /**
   * Each iteration, pop an unsolved node and attempt to find the routes inside
   * of it.
   */
  _step() {
    this.updateCacheStats()
    if (this.activeSubSolver) {
      this.activeSubSolver.step()
      if (this.activeSubSolver.solved) {
        this.routes.push(...this.activeSubSolver.solvedRoutes)
        this.recordNodeSolveMetadata(this.activeSubSolver, "solved")
        this.recordSolvedNodeStats(
          this.activeSubSolver,
          this.activeSubSolver.nodeWithPortPoints,
        )
        this.activeSubSolver = null
      } else if (this.activeSubSolver.failed) {
        this.recordNodeSolveMetadata(this.activeSubSolver, "failed")
        this.failedSolvers.push(this.activeSubSolver)
        this.activeSubSolver = null
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

    this.activeSubSolver = new HyperSingleIntraNodeSolver({
      nodeWithPortPoints: node,
      colorMap: this.colorMap,
      connMap: this.connMap,
      viaDiameter: this.viaDiameter,
      traceWidth: this.traceWidth,
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
              : safeTransparentize(segment.color, 0.75),
          layer: `z${segment.z}`,
          strokeWidth: route.traceThickness,
          strokeDash: segment.z !== 0 ? "10, 5" : undefined,
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
        const left = metadata.node.center.x - metadata.node.width / 2
        const right = metadata.node.center.x + metadata.node.width / 2
        const top = metadata.node.center.y - metadata.node.height / 2
        const bottom = metadata.node.center.y + metadata.node.height / 2

        const label = this.createNodeMarkerLabel(capacityMeshNodeId, metadata)

        graphics.lines!.push(
          {
            points: [
              { x: left, y: top },
              { x: right, y: top },
            ],
            layer: "hd_node_boundaries",
            strokeColor: "red",
            strokeDash: "6, 4",
            strokeWidth: 0.03,
            label,
          },
          {
            points: [
              { x: right, y: top },
              { x: right, y: bottom },
            ],
            layer: "hd_node_boundaries",
            strokeColor: "red",
            strokeDash: "6, 4",
            strokeWidth: 0.03,
            label,
          },
          {
            points: [
              { x: right, y: bottom },
              { x: left, y: bottom },
            ],
            layer: "hd_node_boundaries",
            strokeColor: "red",
            strokeDash: "6, 4",
            strokeWidth: 0.03,
            label,
          },
          {
            points: [
              { x: left, y: bottom },
              { x: left, y: top },
            ],
            layer: "hd_node_boundaries",
            strokeColor: "red",
            strokeDash: "6, 4",
            strokeWidth: 0.03,
            label,
          },
        )

        if (metadata.status === "solved") {
          graphics.points!.push({
            x: metadata.node.center.x,
            y: metadata.node.center.y,
            color: "red",
            layer: "hd_node_markers",
            label,
          })
        } else {
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
