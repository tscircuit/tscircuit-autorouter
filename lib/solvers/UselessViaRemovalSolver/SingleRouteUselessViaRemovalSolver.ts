import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { GraphicsObject } from "graphics-debug"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { TraceSimplificationSolverAdapter } from "../../bindings/trace-simplification/TraceSimplificationSolverAdapter"
import type { RouteSection } from "./route-section"

type RoutePoint = HighDensityRoute["route"][number]

type ViaPairShortcut = {
  path: RoutePoint[]
  previousPointIndex: number
  nextPointIndex: number
  savedLength: number
  validationFirstSegmentIndex?: number
}

type ObstacleDetourPath = {
  path: RoutePoint[]
  length: number
  longestSegmentIndex: number
}

type MultilayerSectionCollapse = {
  targetZ: number
  mergeWith: "previous" | "next"
}

export class SingleRouteUselessViaRemovalSolver extends TraceSimplificationSolverAdapter {
  static solverKind = "single-via-removal"
  static stateFields = ["obstacleSHI", "hdRouteSHI", "unsimplifiedRoute", "connMap", "outline", "terminalLayerIndicesByPcbPortId", "routeSections", "currentSectionIndex", "TRACE_THICKNESS", "OBSTACLE_MARGIN", "GEOMETRY_SHORTCUT_TRACE_MARGIN", "GEOMETRY_SHORTCUT_OBSTACLE_MARGIN", "MAX_GEOMETRY_SHORTCUT_ADDED_LENGTH", "ENABLE_GEOMETRY_SHORTCUTS", "ENABLE_OBSTACLE_DETOUR_SHORTCUTS", "PRESERVE_ROUTE_ENDPOINTS", "geometryShortcutsApplied", "multilayerSectionsCollapsed", "obstacleDetourCandidatesValidated"]

  declare obstacleSHI: ObstacleSpatialHashIndex
  declare hdRouteSHI: HighDensityRouteSpatialIndex
  declare unsimplifiedRoute: HighDensityRoute
  declare connMap: ConnectivityMap
  declare outline: Array<{ x: number; y: number }> | undefined
  declare terminalLayerIndicesByPcbPortId: ReadonlyMap<string, ReadonlySet<number>> | undefined
  declare routeSections: RouteSection[]
  declare currentSectionIndex: number
  declare TRACE_THICKNESS: number
  declare OBSTACLE_MARGIN: number
  declare GEOMETRY_SHORTCUT_TRACE_MARGIN: number
  declare GEOMETRY_SHORTCUT_OBSTACLE_MARGIN: number
  declare MAX_GEOMETRY_SHORTCUT_ADDED_LENGTH: number
  declare ENABLE_GEOMETRY_SHORTCUTS: boolean
  declare ENABLE_OBSTACLE_DETOUR_SHORTCUTS: boolean
  declare PRESERVE_ROUTE_ENDPOINTS: boolean
  declare geometryShortcutsApplied: number
  declare multilayerSectionsCollapsed: number
  declare obstacleDetourCandidatesValidated: number

  constructor(params: {
    obstacleSHI: ObstacleSpatialHashIndex
    hdRouteSHI: HighDensityRouteSpatialIndex
    unsimplifiedRoute: HighDensityRoute
    connMap: ConnectivityMap
    outline?: Array<{ x: number; y: number }>
    geometryShortcutTraceMargin?: number
    geometryShortcutObstacleMargin?: number
    enableGeometryShortcuts?: boolean
    enableObstacleDetourShortcuts?: boolean
    preserveRouteEndpoints?: boolean
    terminalLayerIndicesByPcbPortId?: ReadonlyMap<string, ReadonlySet<number>>
  }) {
    super(params)
  }

  override getSolverName(): string { return "SingleRouteUselessViaRemovalSolver" }
  private getPathLength(points: RoutePoint[]): number { return this.invoke("getPathLength", [points]) as number }
  private normalizeShortcutPath(path: Array<{ x: number; y: number }>, start: RoutePoint, end: RoutePoint): RoutePoint[] {
    return this.invoke("normalizeShortcutPath", [path, start, end]) as RoutePoint[]
  }
  private shortcutCrossesOutline(path: RoutePoint[]): boolean { return this.invoke("shortcutCrossesOutline", [path]) as boolean }
  private getObstacleDetourPaths(start: RoutePoint, end: RoutePoint, targetZ: number, maxPathLength: number): ObstacleDetourPath[] {
    return this.invoke("getObstacleDetourPaths", [start, end, targetZ, maxPathLength]) as ObstacleDetourPath[]
  }
  private getDirectGeometryShortcut(previous: RouteSection, current: RouteSection, next: RouteSection): ViaPairShortcut | null {
    return this.invoke("getDirectGeometryShortcut", [previous, current, next]) as ViaPairShortcut | null
  }
  private getObstacleDetourShortcut(previous: RouteSection, current: RouteSection, next: RouteSection): ViaPairShortcut | null {
    return this.invoke("getObstacleDetourShortcut", [previous, current, next]) as ViaPairShortcut | null
  }
  private findGeometryShortcut(previous: RouteSection, current: RouteSection, next: RouteSection): ViaPairShortcut | null {
    return this.invoke("findGeometryShortcut", [previous, current, next]) as ViaPairShortcut | null
  }
  private applyGeometryShortcut(shortcut: ViaPairShortcut): void { this.invoke("applyGeometryShortcut", [shortcut]) }
  private findMultilayerSectionCollapse(previous: RouteSection, current: RouteSection, next: RouteSection): MultilayerSectionCollapse | null {
    return this.invoke("findMultilayerSectionCollapse", [previous, current, next]) as MultilayerSectionCollapse | null
  }
  private applyMultilayerSectionCollapse(collapse: MultilayerSectionCollapse): void { this.invoke("applyMultilayerSectionCollapse", [collapse]) }
  getConstructorParams(): ConstructorParameters<typeof SingleRouteUselessViaRemovalSolver>[0] {
    return {
      obstacleSHI: this.obstacleSHI,
      hdRouteSHI: this.hdRouteSHI,
      unsimplifiedRoute: this.unsimplifiedRoute,
      connMap: this.connMap,
      outline: this.outline,
      geometryShortcutTraceMargin: this.GEOMETRY_SHORTCUT_TRACE_MARGIN,
      geometryShortcutObstacleMargin: this.GEOMETRY_SHORTCUT_OBSTACLE_MARGIN,
      enableGeometryShortcuts: this.ENABLE_GEOMETRY_SHORTCUTS,
      enableObstacleDetourShortcuts: this.ENABLE_OBSTACLE_DETOUR_SHORTCUTS,
      preserveRouteEndpoints: this.PRESERVE_ROUTE_ENDPOINTS,
      terminalLayerIndicesByPcbPortId: this.terminalLayerIndicesByPcbPortId,
    }
  }

  getOptimizedHdRoute(): HighDensityRoute { return this.invoke("getOptimizedHdRoute", []) as HighDensityRoute }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject &
      Pick<Required<GraphicsObject>, "points" | "lines" | "rects" | "circles"> =
      {
        circles: [],
        lines: [],
        points: [],
        rects: [],
        coordinateSystem: "cartesian",
        title: "Single Route Useless Via Removal Solver",
      }

    // Draw the sections, draw the active section in orange

    for (let i = 0; i < this.routeSections.length; i++) {
      const section = this.routeSections[i]
      graphics.lines.push({
        points: section.points,
        strokeWidth: this.TRACE_THICKNESS,
        strokeColor:
          i === this.currentSectionIndex
            ? "orange"
            : section.z === 0
              ? "red"
              : "blue",
      })
    }

    return graphics
  }
}

TraceSimplificationSolverAdapter.register("single-via-removal", SingleRouteUselessViaRemovalSolver)
