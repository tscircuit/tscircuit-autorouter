import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "../../solvers/BaseSolver"
import { safeTransparentize } from "../../solvers/colors"
import { mergeRouteSegments } from "lib/utils/mergeRouteSegments"

/**
 * A simplified high density solver that directly connects port points
 * within each node without considering intersections or vias.
 *
 * This is useful when the input is guaranteed to have no crossings
 * (e.g. from a well-assigned port point pathing solver).
 *
 * Only solves intra-node routing - connecting port points within a single node.
 */
export class SimpleHighDensitySolver extends BaseSolver {
  unsolvedNodes: NodeWithPortPoints[]
  routes: HighDensityIntraNodeRoute[]
  colorMap: Record<string, string>
  traceWidth: number
  viaDiameter: number

  constructor({
    nodePortPoints,
    colorMap,
    traceWidth = 0.15,
    viaDiameter = 0.6,
  }: {
    nodePortPoints: NodeWithPortPoints[]
    colorMap?: Record<string, string>
    traceWidth?: number
    viaDiameter?: number
  }) {
    super()
    this.unsolvedNodes = [...nodePortPoints]
    this.colorMap = colorMap ?? {}
    this.routes = []
    this.traceWidth = traceWidth
    this.viaDiameter = viaDiameter
    this.MAX_ITERATIONS = nodePortPoints.length + 1
  }

  _step() {
    if (this.unsolvedNodes.length === 0) {
      this.solved = true
      return
    }

    const node = this.unsolvedNodes.pop()!

    // Group port points within this node by connectionName
    const connectionGroups = new Map<
      string,
      Array<{ x: number; y: number; z: number; rootConnectionName?: string }>
    >()

    for (const pt of node.portPoints) {
      if (!connectionGroups.has(pt.connectionName)) {
        connectionGroups.set(pt.connectionName, [])
      }
      connectionGroups.get(pt.connectionName)!.push({
        x: pt.x,
        y: pt.y,
        z: pt.z,
        rootConnectionName: pt.rootConnectionName,
      })
    }

    // Create routes for connections with 2+ port points in this node
    for (const [connectionName, points] of connectionGroups) {
      if (points.length < 2) continue

      // Use the z from the first point (all should be same since no vias)
      const z = points[0].z

      const route: HighDensityIntraNodeRoute = {
        connectionName,
        rootConnectionName: points[0].rootConnectionName,
        traceThickness: this.traceWidth,
        viaDiameter: this.viaDiameter,
        route: points.map((p) => ({ x: p.x, y: p.y, z })),
        vias: [], // No vias needed
      }

      this.routes.push(route)
    }
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    for (const route of this.routes) {
      const mergedSegments = mergeRouteSegments(
        route.route,
        route.connectionName,
        this.colorMap[route.connectionName],
      )

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
    }

    return graphics
  }
}
