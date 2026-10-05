import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { safeTransparentize } from "lib/solvers/colors"
import type { CapacityMeshNodeId } from "lib/types/capacity-mesh-types"
import type {
  HighDensityIntraNodeRoute,
  PortPoint,
} from "lib/types/high-density-types"
import { mergeRouteSegments } from "lib/utils/mergeRouteSegments"
import {
  applyMatrixToPoint,
  projectPointToRectBoundary,
  type Point,
} from "./geometry"
import type { PolyNodeWithPortPoints } from "./types"

const pointDistanceSq = (a: Point, b: Point) =>
  (a.x - b.x) ** 2 + (a.y - b.y) ** 2

type ProjectedPortRecord = {
  projected: PortPoint
  original: PortPoint
}

const getProjectedPortsForNode = (
  nodeWithPortPoints: PolyNodeWithPortPoints,
): ProjectedPortRecord[] => {
  if (!nodeWithPortPoints.projectedRect) {
    throw new Error("Poly node is missing projectedRect")
  }

  return nodeWithPortPoints.portPoints.map((portPoint) => {
    const projectedPoint = projectPointToRectBoundary(
      portPoint,
      nodeWithPortPoints.projectedRect!,
    )
    return {
      original: portPoint,
      projected: {
        ...portPoint,
        x: projectedPoint.x,
        y: projectedPoint.y,
      },
    }
  })
}

const findOriginalPortForRouteEndpoint = (
  projectedPorts: ProjectedPortRecord[],
  connectionName: string,
  projectedPoint?: Point & { z?: number },
) => {
  if (!projectedPoint) return undefined

  const sameConnectionPorts = projectedPorts.filter(
    ({ projected }) =>
      projected.connectionName === connectionName &&
      (projectedPoint.z === undefined || projected.z === projectedPoint.z),
  )
  if (sameConnectionPorts.length === 0) return undefined

  return sameConnectionPorts.reduce((best, candidate) =>
    pointDistanceSq(candidate.projected, projectedPoint) <
    pointDistanceSq(best.projected, projectedPoint)
      ? candidate
      : best,
  ).original
}

export const projectHighDensityRouteToPolygon = (
  route: HighDensityIntraNodeRoute,
  nodeWithPortPoints: PolyNodeWithPortPoints,
): HighDensityIntraNodeRoute => {
  const projectedRect = nodeWithPortPoints.projectedRect
  if (!projectedRect) {
    throw new Error("Poly node is missing projectedRect")
  }

  const matrix = projectedRect.rectToPolygonMatrix
  const projectedPorts = getProjectedPortsForNode(nodeWithPortPoints)
  const projectedRoute = route.route.map((point) => ({
    ...point,
    ...applyMatrixToPoint(matrix, point),
  }))
  const projectedVias = route.vias.map((via) => applyMatrixToPoint(matrix, via))

  const firstOriginal = findOriginalPortForRouteEndpoint(
    projectedPorts,
    route.connectionName,
    route.route[0]!,
  )
  const lastOriginal = findOriginalPortForRouteEndpoint(
    projectedPorts,
    route.connectionName,
    route.route[route.route.length - 1]!,
  )

  if (firstOriginal && projectedRoute[0]) {
    projectedRoute[0] = {
      ...projectedRoute[0],
      x: firstOriginal.x,
      y: firstOriginal.y,
      z: firstOriginal.z,
    }
  }
  if (lastOriginal && projectedRoute[projectedRoute.length - 1]) {
    projectedRoute[projectedRoute.length - 1] = {
      ...projectedRoute[projectedRoute.length - 1]!,
      x: lastOriginal.x,
      y: lastOriginal.y,
      z: lastOriginal.z,
    }
  }

  return {
    ...route,
    route: projectedRoute,
    vias: projectedVias,
    jumpers: route.jumpers?.map((jumper) => ({
      ...jumper,
      start: applyMatrixToPoint(matrix, jumper.start),
      end: applyMatrixToPoint(matrix, jumper.end),
    })),
  }
}

export class ProjectHighDensityToPolygonSolver extends BaseSolver {
  override getSolverName(): string {
    return "ProjectHighDensityToPolygonSolver"
  }

  routes: HighDensityIntraNodeRoute[] = []
  routesByNodeId = new Map<CapacityMeshNodeId, HighDensityIntraNodeRoute[]>()
  colorMap: Record<string, string>
  nodePortPoints: PolyNodeWithPortPoints[]
  rawRoutesByNodeId: Map<CapacityMeshNodeId, HighDensityIntraNodeRoute[]>

  constructor({
    nodePortPoints,
    routesByNodeId,
    colorMap,
  }: {
    nodePortPoints: PolyNodeWithPortPoints[]
    routesByNodeId:
      | Map<CapacityMeshNodeId, HighDensityIntraNodeRoute[]>
      | Record<string, HighDensityIntraNodeRoute[]>
    colorMap?: Record<string, string>
  }) {
    super()
    this.MAX_ITERATIONS = 1
    this.nodePortPoints = nodePortPoints
    this.rawRoutesByNodeId =
      routesByNodeId instanceof Map
        ? new Map(routesByNodeId)
        : new Map(Object.entries(routesByNodeId))
    this.colorMap = colorMap ?? {}
  }

  _step() {
    this.routes = []
    this.routesByNodeId = new Map()

    for (const node of this.nodePortPoints) {
      const rawRoutes =
        this.rawRoutesByNodeId.get(node.capacityMeshNodeId) ?? []
      const projectedRoutes = rawRoutes.map((route) =>
        projectHighDensityRouteToPolygon(route, node),
      )
      if (projectedRoutes.length > 0) {
        this.routesByNodeId.set(node.capacityMeshNodeId, projectedRoutes)
        this.routes.push(...projectedRoutes)
      }
    }

    this.solved = true
  }

  getOutput() {
    return this.routes
  }

  getConstructorParams() {
    return [
      {
        nodePortPoints: this.nodePortPoints,
        routesByNodeId: this.rawRoutesByNodeId,
        colorMap: this.colorMap,
      },
    ] as const
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      polygons: this.nodePortPoints.flatMap((node) => [
        {
          points: node.polygon,
          fill: "rgba(40, 140, 220, 0.06)",
          stroke: "rgba(20, 70, 160, 0.65)",
          label: `${node.capacityMeshNodeId} polygon`,
        },
        ...(node.projectedRect
          ? [
              {
                points: node.projectedRect.targetQuad,
                fill: "rgba(255, 165, 0, 0.05)",
                stroke: "rgba(255, 120, 0, 0.45)",
                label: `${node.capacityMeshNodeId} projection target`,
              },
            ]
          : []),
      ]),
      lines: [],
      circles: [],
    }

    for (const route of this.routes) {
      const routeColor = this.colorMap[route.connectionName] ?? "#0000ff"
      const mergedSegments = mergeRouteSegments(
        route.route,
        route.connectionName,
        routeColor,
      )

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
          fill: routeColor,
          label: `${route.connectionName} via`,
        })
      }
    }

    return graphics
  }
}
