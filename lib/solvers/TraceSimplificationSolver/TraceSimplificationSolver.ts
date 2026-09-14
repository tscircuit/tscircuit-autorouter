import "../UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import "../UselessViaRemovalSolver/UselessViaRemovalSolver"
import "../SameNetViaMergerSolver/SameNetViaMergerSolver"
import "../SimplifiedPathSolver/MultiSimplifiedPathSolver"
import "../CrossingViaReductionSolver/crossing-via-reduction-solver"
import type { BaseSolver } from "../BaseSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { UselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
import { MultiSimplifiedPathSolver } from "lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { GraphicsObject } from "graphics-debug"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"
import { CrossingViaReductionSolver } from "lib/solvers/CrossingViaReductionSolver/crossing-via-reduction-solver"
import { TraceSimplificationSolverAdapter } from "lib/bindings/trace-simplification/TraceSimplificationSolverAdapter"

type Phase =
  | "via_removal"
  | "crossing_via_reduction"
  | "via_merging"
  | "path_simplification"
type ExtractResult = (solver: BaseSolver) => HighDensityRoute[]
export type TraceSimplificationConfig = {
  readonly hdRoutes: ReadonlyArray<HighDensityRoute>
  readonly obstacles: ReadonlyArray<Obstacle>
  readonly connMap: ConnectivityMap
  readonly colorMap: Readonly<Record<string, string>>
  readonly outline?: ReadonlyArray<{ x: number; y: number }>
  readonly defaultViaDiameter: number
  readonly layerCount: number
  readonly minTraceToPadEdgeClearance?: number
  readonly minBoardEdgeClearance?: number
  readonly otherHdRoutes?: ReadonlyArray<HighDensityRoute>
  readonly netByConnectionName?: ReadonlyMap<string, string>
  readonly enableCrossingViaReduction?: boolean
  readonly preserveRouteEndpoints?: boolean
  readonly useTraceWidthAwareClearance?: boolean
  readonly enableVertexShortcuts?: boolean
  readonly terminalLayerIndicesByPcbPortId?: ReadonlyMap<
    string,
    ReadonlySet<number>
  >
}

export class TraceSimplificationSolver extends TraceSimplificationSolverAdapter {
  static override solverKind = "trace"
  static override stateFields = [
    "hdRoutes",
    "preservedRouteEndpoints",
    "simplificationPipelineLoops",
    "MAX_SIMPLIFICATION_PIPELINE_LOOPS",
    "PHASE_ORDER",
    "currentPhase",
    "activeSubSolver",
    "simplificationConfig",
  ]
  declare hdRoutes: HighDensityRoute[]
  private declare readonly preservedRouteEndpoints?: ReadonlyMap<
    string,
    {
      start: HighDensityRoute["route"][number]
      end: HighDensityRoute["route"][number]
    }
  >
  declare simplificationPipelineLoops: number
  declare MAX_SIMPLIFICATION_PIPELINE_LOOPS: number
  declare PHASE_ORDER: Phase[]
  declare currentPhase: Phase
  private declare readonly simplificationConfig: TraceSimplificationConfig
  private customExtractor: ExtractResult | null = null
  private defaultExtractorChild: BaseSolver | null = null
  private defaultExtractor: ExtractResult | null = null

  constructor(config: TraceSimplificationConfig) {
    super(config)
  }
  override getSolverName(): string {
    return "TraceSimplificationSolver"
  }
  get simplifiedHdRoutes(): HighDensityRoute[] {
    return this.output()
  }

  get extractResult(): ExtractResult | null {
    const mode = this.readSolverField("extractMode")
    if (mode === "null") return null
    if (mode === "custom") return this.customExtractor
    const child = this.activeSubSolver
    if (!child) return null
    if (child !== this.defaultExtractorChild) {
      this.defaultExtractorChild = child
      switch (this.currentPhase) {
        case "via_removal":
          this.defaultExtractor = (solver) =>
            (solver as UselessViaRemovalSolver).getOptimizedHdRoutes() ?? []
          break
        case "crossing_via_reduction":
          this.defaultExtractor = (solver) =>
            (solver as CrossingViaReductionSolver).getReducedHdRoutes()
          break
        case "via_merging":
          this.defaultExtractor = (solver) =>
            (solver as SameNetViaMergerSolver).getMergedViaHdRoutes() ?? []
          break
        case "path_simplification":
          this.defaultExtractor = (solver) =>
            (solver as MultiSimplifiedPathSolver).simplifiedHdRoutes
          break
      }
    }
    return this.defaultExtractor
  }

  set extractResult(value: ExtractResult | null) {
    this.readSolverField("extractMode")
    this.customExtractor = value
    this.stateValues.extractMode = value === null ? "null" : "custom"
  }

  protected override canSolveInBindings(): boolean {
    return this.stateValues.extractMode !== "custom"
  }

  protected override resolveSolverStep(status: number): number {
    status = super.resolveSolverStep(status)
    if ((status & 4) === 0) return status
    this.sync()
    const child = this.activeSubSolver
    if (!child || !this.customExtractor)
      throw new Error("Missing custom trace extraction callback")
    const routes = this.customExtractor(child)
    this.push()
    return super.resolveSolverStep(
      this.runSolver(() =>
        this.binding.resolveExtract(this.graph.graph(routes)),
      ),
    )
  }

  private validatePreservedRouteEndpoints(routes: HighDensityRoute[]): void {
    this.callSolver(this.binding.validatePreservedRouteEndpoints, [routes])
  }
  private isSameNetObstacle(
    route: HighDensityRoute,
    obstacle: Obstacle,
  ): boolean {
    return this.callSolver(this.binding.isSameNetObstacle, [route, obstacle])
  }
  private getSameNetObstacleForSegment(
    route: HighDensityRoute,
    start: { x: number; y: number },
    end: { x: number; y: number },
  ): Obstacle | undefined {
    return (
      this.callSolver(this.binding.getSameNetObstacleForSegment, [
        route,
        start,
        end,
      ]) ?? undefined
    )
  }
  private isViaInsideSameNetObstacle(
    route: HighDensityRoute,
    via: { x: number; y: number },
  ): boolean {
    return this.callSolver(this.binding.isViaInsideSameNetObstacle, [
      route,
      via,
    ])
  }
  markThroughObstacleSegments(
    routes: ReadonlyArray<HighDensityRoute>,
  ): HighDensityRoute[] {
    return this.callSolver(this.binding.markThroughObstacleSegments, [routes])
  }
  visualize(): GraphicsObject {
    if (this.activeSubSolver) {
      return this.activeSubSolver.visualize()
    }

    const visualization: GraphicsObject & {
      lines: NonNullable<GraphicsObject["lines"]>
      points: NonNullable<GraphicsObject["points"]>
      rects: NonNullable<GraphicsObject["rects"]>
      circles: NonNullable<GraphicsObject["circles"]>
    } = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
      coordinateSystem: "cartesian",
      title: "Trace Simplification Solver",
    }

    // Visualize obstacles
    for (const obstacle of this.simplificationConfig.obstacles) {
      let fillColor = "rgba(128, 128, 128, 0.2)"
      const isOnLayer0 = obstacle.__zLayers?.includes(0)
      const isOnLayer1 = obstacle.__zLayers?.includes(1)

      if (isOnLayer0 && isOnLayer1) {
        fillColor = "rgba(128, 0, 128, 0.2)"
      } else if (isOnLayer0) {
        fillColor = "rgba(255, 0, 0, 0.2)"
      } else if (isOnLayer1) {
        fillColor = "rgba(0, 0, 255, 0.2)"
      }

      visualization.rects.push({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: fillColor,
        label: `Obstacle (Z: ${obstacle.__zLayers?.join(", ")})`,
      })
    }

    // Draw immutable routed copper as subdued, dashed layer-colored peers.
    for (const route of this.simplificationConfig.otherHdRoutes ?? []) {
      for (let i = 0; i < route.route.length - 1; i++) {
        const current = route.route[i]
        const next = route.route[i + 1]
        if (current.z !== next.z) continue

        visualization.lines.push({
          points: [
            { x: current.x, y: current.y },
            { x: next.x, y: next.y },
          ],
          strokeColor:
            current.z === 0
              ? "rgba(160, 32, 32, 0.55)"
              : "rgba(32, 32, 160, 0.55)",
          strokeWidth: route.traceThickness,
          strokeDash: [0.08, 0.08],
          label: `${route.connectionName} immutable (z=${current.z})`,
        })
      }

      for (const via of route.vias) {
        visualization.circles.push({
          center: { x: via.x, y: via.y },
          radius: route.viaDiameter / 2,
          fill: "rgba(96, 96, 96, 0.45)",
          label: `${route.connectionName} immutable via`,
        })
      }
    }

    // Draw output routes and vias
    for (const route of this.hdRoutes) {
      if (route.route.length === 0) continue

      // Draw lines connecting route points on the same layer
      for (let i = 0; i < route.route.length - 1; i++) {
        const current = route.route[i]
        const next = route.route[i + 1]

        if (current.z === next.z) {
          visualization.lines.push({
            points: [
              { x: current.x, y: current.y },
              { x: next.x, y: next.y },
            ],
            strokeColor: current.z === 0 ? "red" : "blue",
            strokeWidth: route.traceThickness,
            label: `${route.connectionName} (z=${current.z})`,
          })
        }
      }

      // Draw circles for vias
      for (const via of route.vias) {
        visualization.circles.push({
          center: { x: via.x, y: via.y },
          radius: route.viaDiameter / 2,
          fill: "rgba(255, 0, 255, 0.5)",
          label: `${route.connectionName} via`,
        })
      }

      // Draw jumpers
      if (route.jumpers && route.jumpers.length > 0) {
        const jumperGraphics = getJumpersGraphics(route.jumpers, {
          color: "orange",
          label: route.connectionName,
        })
        visualization.rects.push(...(jumperGraphics.rects ?? []))
        visualization.lines.push(...(jumperGraphics.lines ?? []))
      }
    }

    return visualization
  }
}
TraceSimplificationSolverAdapter.register("trace", TraceSimplificationSolver)
