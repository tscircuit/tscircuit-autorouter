import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import type { RouteSection } from "../UselessViaRemovalSolver/route-section"
import { TraceSimplificationSolverAdapter } from "lib/bindings/trace-simplification/TraceSimplificationSolverAdapter"

export interface CrossingViaReductionSolverInput {
  inputHdRoutes: ReadonlyArray<HighDensityRoute>
  otherHdRoutes?: ReadonlyArray<HighDensityRoute>
  obstacles: ReadonlyArray<Obstacle>
  connMap: ConnectivityMap
  layerCount: number
  outline?: ReadonlyArray<{ x: number; y: number }>
  traceMargin?: number
  obstacleMargin?: number
}


export class CrossingViaReductionSolver extends TraceSimplificationSolverAdapter {
  static solverKind = "crossing"
  static stateFields = ["stats", "reducedHdRoutes", "traceMargin", "obstacleMargin", "obstacleSHI"]
  declare reducedHdRoutes: HighDensityRoute[]
  private readonly input: CrossingViaReductionSolverInput

  constructor(input: CrossingViaReductionSolverInput) {
    super(input)
    this.input = { ...input, obstacles: createObjectsWithZLayers([...input.obstacles], input.layerCount) }
  }

  override getSolverName(): string { return "CrossingViaReductionSolver" }
  private collapseDetourSection(input: { route: HighDensityRoute; section: RouteSection; targetZ: number }): HighDensityRoute {
    return this.invoke("collapseDetourSection", [input]) as HighDensityRoute
  }

  private relocateTransitionVia(input: { route: HighDensityRoute; section: RouteSection; targetZ: number; side: "start" | "end"; newViaDistance: number }): { route: HighDensityRoute; relocatedVia: { x: number; y: number } } | null {
    return this.invoke("relocateTransitionVia", [input]) as { route: HighDensityRoute; relocatedVia: { x: number; y: number } } | null
  }

  private relocateTransitionVias(input: { route: HighDensityRoute; sections: RouteSection[]; crossingGroups: Array<{ transitionRouteIndex: number; transitionSectionIndex: number; side: "start" | "end"; crossingDistances: number[] }>; detourZ: number; detourTraceThickness: number }): { route: HighDensityRoute; relocatedVias: Array<{ x: number; y: number }> } | null {
    return this.invoke("relocateTransitionVias", [input]) as { route: HighDensityRoute; relocatedVias: Array<{ x: number; y: number }> } | null
  }

  private findCrossingReduction(): { detourRouteIndex: number; detourRoute: HighDensityRoute; transitionUpdates: Array<{ routeIndex: number; route: HighDensityRoute; relocatedVias: Array<{ x: number; y: number }> }> } | null {
    return this.invoke("findCrossingReduction", []) as { detourRouteIndex: number; detourRoute: HighDensityRoute; transitionUpdates: Array<{ routeIndex: number; route: HighDensityRoute; relocatedVias: Array<{ x: number; y: number }> }> } | null
  }

  getReducedHdRoutes(): HighDensityRoute[] { return this.invoke("getReducedHdRoutes", []) as HighDensityRoute[] }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject &
      Pick<Required<GraphicsObject>, "lines" | "circles" | "rects"> = {
      lines: [],
      circles: [],
      rects: [],
      coordinateSystem: "cartesian",
      title: "Crossing Via Reduction Solver",
    }
    for (const obstacle of this.input.obstacles) {
      graphics.rects.push({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: "rgba(128, 128, 128, 0.2)",
      })
    }
    for (const route of this.reducedHdRoutes) {
      for (let index = 1; index < route.route.length; index++) {
        const start = route.route[index - 1]
        const end = route.route[index]
        if (start.z !== end.z) continue
        graphics.lines.push({
          points: [start, end],
          strokeColor: start.z === 0 ? "#d32f2f" : "#3367a8",
          strokeWidth: route.traceThickness,
          label: `${route.connectionName} (z=${start.z})`,
        })
      }
      for (const via of route.vias) {
        graphics.circles.push({
          center: via,
          radius: route.viaDiameter / 2,
          fill: "#ff20d6",
          label: `${route.connectionName} via`,
        })
      }
    }
    return graphics
  }
}

TraceSimplificationSolverAdapter.register("crossing", CrossingViaReductionSolver)
