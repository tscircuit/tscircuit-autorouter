import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { CapacityMeshNodeId } from "lib/types/capacity-mesh-types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { mergeRouteSegments } from "lib/utils/mergeRouteSegments"
import { safeTransparentize } from "lib/solvers/colors"
import { solveSpacePointToProjectedRectPoint } from "./geometry"
import { PolySingleIntraNodeSolver } from "./PolySingleIntraNodeSolver"
import type { PolyNodeWithPortPoints } from "./types"

export class PolyHighDensitySolver extends BaseSolver {
  override getSolverName(): string {
    return "PolyHighDensitySolver"
  }

  unsolvedNodePortPoints: PolyNodeWithPortPoints[]
  nodePortPoints: PolyNodeWithPortPoints[]
  routes: HighDensityIntraNodeRoute[] = []
  routesByNodeId = new Map<CapacityMeshNodeId, HighDensityIntraNodeRoute[]>()
  failedSolvers: PolySingleIntraNodeSolver[] = []
  activeSubSolver: PolySingleIntraNodeSolver | null = null
  colorMap: Record<string, string>
  connMap?: ConnectivityMap
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  effort: number
  nodePfById: Map<CapacityMeshNodeId, number | null>

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
    nodePortPoints: PolyNodeWithPortPoints[]
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
    this.nodePortPoints = [...nodePortPoints]
    this.unsolvedNodePortPoints = [...nodePortPoints]
    this.colorMap = colorMap ?? {}
    this.connMap = connMap
    this.viaDiameter = viaDiameter ?? 0.3
    this.traceWidth = traceWidth ?? 0.15
    this.obstacleMargin = obstacleMargin ?? 0.15
    this.effort = effort ?? 1
    this.MAX_ITERATIONS = 10e6 * this.effort
    this.nodePfById =
      nodePfById instanceof Map
        ? new Map(nodePfById)
        : new Map(Object.entries(nodePfById ?? {}))
  }

  _step() {
    if (this.activeSubSolver) {
      this.activeSubSolver.step()
      if (this.activeSubSolver.solved) {
        const nodeId =
          this.activeSubSolver.params.nodeWithPortPoints.capacityMeshNodeId
        const routes = this.activeSubSolver.solvedRoutes
        this.routesByNodeId.set(nodeId, [
          ...(this.routesByNodeId.get(nodeId) ?? []),
          ...routes,
        ])
        this.routes.push(...this.activeSubSolver.solvedRoutes)
        this.activeSubSolver = null
      } else if (this.activeSubSolver.failed) {
        this.failedSolvers.push(this.activeSubSolver)
        this.activeSubSolver = null
      }
      return
    }

    if (this.unsolvedNodePortPoints.length === 0) {
      if (this.failedSolvers.length > 0) {
        this.failed = true
        this.error = `Failed to solve ${this.failedSolvers.length} poly nodes, ${this.failedSolvers
          .slice(0, 5)
          .map((solver) => solver.params.nodeWithPortPoints.capacityMeshNodeId)
          .join(", ")}. err0: ${this.failedSolvers[0]?.error}`
        return
      }

      this.solved = true
      return
    }

    const node = this.unsolvedNodePortPoints.pop()!
    this.activeSubSolver = new PolySingleIntraNodeSolver({
      nodeWithPortPoints: node,
      colorMap: this.colorMap,
      connMap: this.connMap,
      viaDiameter: this.viaDiameter,
      traceWidth: this.traceWidth,
      obstacleMargin: this.obstacleMargin,
      effort: this.effort,
    })
  }

  computeProgress() {
    const total =
      this.routes.length +
      this.failedSolvers.length +
      this.unsolvedNodePortPoints.length +
      (this.activeSubSolver ? 1 : 0)
    if (total === 0) return 1
    return (
      (this.routes.length +
        this.failedSolvers.length +
        (this.activeSubSolver?.progress ?? 0)) /
      total
    )
  }

  getConstructorParams() {
    return [
      {
        nodePortPoints: this.nodePortPoints,
        colorMap: this.colorMap,
        connMap: this.connMap,
        viaDiameter: this.viaDiameter,
        traceWidth: this.traceWidth,
        obstacleMargin: this.obstacleMargin,
        effort: this.effort,
        nodePfById: this.nodePfById,
      },
    ] as const
  }

  visualize(): GraphicsObject {
    const polygonViz: GraphicsObject = {
      polygons: this.nodePortPoints.map((node) => ({
        points: node.polygon,
        fill: "rgba(180, 180, 180, 0.05)",
        stroke: "rgba(120, 120, 120, 0.25)",
        label: `${node.capacityMeshNodeId} polygon`,
      })),
      rects: this.nodePortPoints.flatMap((node) =>
        node.projectedRect
          ? [
              {
                center: node.projectedRect.center,
                width: node.projectedRect.width,
                height: node.projectedRect.height,
                ccwRotationDegrees: node.projectedRect.ccwRotationDegrees,
                fill: "rgba(255, 165, 0, 0.08)",
                stroke: "rgba(255, 120, 0, 0.65)",
                label: `${node.capacityMeshNodeId} projectedRect`,
              },
            ]
          : [],
      ),
      lines: [],
      circles: [],
      points: this.nodePortPoints.flatMap((node) =>
        node.portPoints.map((point) => ({
          x: point.x,
          y: point.y,
          color: "rgba(80, 80, 80, 0.5)",
          label: `${point.connectionName} original`,
        })),
      ),
    }

    for (const [nodeId, routes] of this.routesByNodeId) {
      const node = this.nodePortPoints.find(
        (candidate) => candidate.capacityMeshNodeId === nodeId,
      )
      const projectedRect = node?.projectedRect
      if (!projectedRect) continue

      for (const route of routes) {
        const routeColor = this.colorMap[route.connectionName] ?? "#0000ff"
        const projectedRectRoute = {
          ...route,
          route: route.route.map((point) => ({
            ...point,
            ...solveSpacePointToProjectedRectPoint(point, projectedRect),
          })),
          vias: route.vias.map((via) =>
            solveSpacePointToProjectedRectPoint(via, projectedRect),
          ),
        }
        const mergedSegments = mergeRouteSegments(
          projectedRectRoute.route,
          route.connectionName,
          routeColor,
        )

        for (const segment of mergedSegments) {
          polygonViz.lines!.push({
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

        for (const via of projectedRectRoute.vias) {
          polygonViz.circles!.push({
            center: via,
            layer: "z0,1",
            radius: route.viaDiameter / 2,
            fill: routeColor,
            label: `${route.connectionName} via`,
          })
        }
      }
    }

    const activeSubSolverViz = this.activeSubSolver?.visualize()
    if (activeSubSolverViz) {
      polygonViz.polygons!.push(
        ...this.unsolvedNodePortPoints.map((node) => ({
          points: node.polygon,
          fill: "rgba(180, 180, 180, 0.08)",
          stroke: "rgba(120, 120, 120, 0.4)",
          label: node.capacityMeshNodeId,
        })),
      )
    }

    return activeSubSolverViz
      ? combineVisualizations(polygonViz, activeSubSolverViz)
      : polygonViz
  }
}
