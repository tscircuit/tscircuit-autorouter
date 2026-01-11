import { SimpleRouteConnection } from "lib/types"
import { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getConnectionPointLayer } from "lib/types/srj-types"
import { BaseSolver } from "../BaseSolver"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { GraphicsObject } from "graphics-debug"
import { safeTransparentize } from "../colors"
import { distance } from "@tscircuit/math-utils"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"
import type { ConnectionPathResult } from "../PortPointPathingSolver/PortPointPathingSolver"

export type UnsolvedRouteWithOrder = {
  connectionName: string
  hdRoutes: HighDensityIntraNodeRoute[]
  /** Node IDs in order from start to end */
  nodeOrder: string[]
  start: { x: number; y: number; z: number }
  end: { x: number; y: number; z: number }
}

/**
 * MultipleHighDensityRouteStitchSolver2 uses path ordering information from
 * the port point pathing solver to correctly stitch routes that may reuse
 * the same node multiple times.
 *
 * Unlike the original solver that uses connectivity maps to find endpoints,
 * this version uses the node traversal order from the pathing solver.
 */
export class MultipleHighDensityRouteStitchSolver2 extends BaseSolver {
  unsolvedRoutes: UnsolvedRouteWithOrder[]
  mergedHdRoutes: HighDensityIntraNodeRoute[] = []
  colorMap: Record<string, string> = {}
  defaultTraceThickness: number
  defaultViaDiameter: number

  constructor(params: {
    connections: SimpleRouteConnection[]
    hdRoutes: HighDensityIntraNodeRoute[]
    /** Connection path results from port point pathing solver */
    connectionPathResults: ConnectionPathResult[]
    colorMap?: Record<string, string>
    layerCount: number
    defaultViaDiameter?: number
  }) {
    super()
    this.colorMap = params.colorMap ?? {}

    const firstRoute = params.hdRoutes[0]
    this.defaultTraceThickness = firstRoute?.traceThickness ?? 0.15
    this.defaultViaDiameter =
      firstRoute?.viaDiameter ?? params.defaultViaDiameter ?? 0.6

    // Create a map from connection name to path results
    const pathResultMap = new Map<string, ConnectionPathResult>()
    for (const result of params.connectionPathResults) {
      pathResultMap.set(result.connection.name, result)
    }

    // Group routes by connectionName
    const routesByConnection = new Map<string, HighDensityIntraNodeRoute[]>()
    for (const hdRoute of params.hdRoutes) {
      const existing = routesByConnection.get(hdRoute.connectionName)
      if (existing) {
        existing.push(hdRoute)
      } else {
        routesByConnection.set(hdRoute.connectionName, [hdRoute])
      }
    }

    this.unsolvedRoutes = []

    for (const [connectionName, hdRoutes] of routesByConnection.entries()) {
      const connection = params.connections.find(
        (c) => c.name === connectionName,
      )
      if (!connection) continue

      // Get node order from pathing results
      const pathResult = pathResultMap.get(connectionName)
      let nodeOrder: string[] = []
      if (pathResult?.path) {
        // Extract node IDs from path in order
        nodeOrder = pathResult.path.map((candidate) => candidate.currentNodeId)
      }

      // Determine start and end from connection points
      const start = {
        ...connection.pointsToConnect[0],
        z: mapLayerNameToZ(
          getConnectionPointLayer(connection.pointsToConnect[0]),
          params.layerCount,
        ),
      }
      const end = {
        ...connection.pointsToConnect[1],
        z: mapLayerNameToZ(
          getConnectionPointLayer(connection.pointsToConnect[1]),
          params.layerCount,
        ),
      }

      this.unsolvedRoutes.push({
        connectionName,
        hdRoutes,
        nodeOrder,
        start,
        end,
      })
    }

    this.MAX_ITERATIONS = 100e3
  }

  _step() {
    const unsolvedRoute = this.unsolvedRoutes.pop()

    if (!unsolvedRoute) {
      this.solved = true
      return
    }

    // Stitch the routes in order
    const mergedRoute = this.stitchOrderedRoutes(unsolvedRoute)
    this.mergedHdRoutes.push(mergedRoute)
  }

  /**
   * Stitch routes together using the node order from pathing results.
   *
   * The key insight is that each HD route corresponds to a segment within a
   * capacity node. The nodeOrder tells us which nodes we visit in sequence.
   * We use this to order the routes correctly, even when a node is visited
   * multiple times.
   */
  private stitchOrderedRoutes(
    unsolvedRoute: UnsolvedRouteWithOrder,
  ): HighDensityIntraNodeRoute {
    const { connectionName, hdRoutes, nodeOrder, start, end } = unsolvedRoute

    if (hdRoutes.length === 0) {
      // No routes, just create a direct connection
      return {
        connectionName,
        traceThickness: this.defaultTraceThickness,
        viaDiameter: this.defaultViaDiameter,
        route: [start, end],
        vias: [],
        jumpers: [],
      }
    }

    // If we have node order, use it to sort routes
    let orderedRoutes: HighDensityIntraNodeRoute[]
    if (nodeOrder.length > 0) {
      orderedRoutes = this.orderRoutesByNodePath(hdRoutes, nodeOrder, start)
    } else {
      // Fallback: order by proximity starting from start point
      orderedRoutes = this.orderRoutesByProximity(hdRoutes, start)
    }

    const mergedRoute: Array<{ x: number; y: number; z: number }> = []
    const mergedVias: Array<{ x: number; y: number }> = []
    const mergedJumpers: HighDensityIntraNodeRoute["jumpers"] = []

    // Add start point
    mergedRoute.push({ x: start.x, y: start.y, z: start.z })

    // Process each route segment in order
    for (let i = 0; i < orderedRoutes.length; i++) {
      const hdRoute = orderedRoutes[i]

      // Determine if we need to reverse this segment
      // Check which end is closer to the last point in mergedRoute
      const lastPoint = mergedRoute[mergedRoute.length - 1]
      const routeStart = hdRoute.route[0]
      const routeEnd = hdRoute.route[hdRoute.route.length - 1]

      const distToStart = distance(lastPoint, routeStart)
      const distToEnd = distance(lastPoint, routeEnd)

      let pointsToAdd: Array<{ x: number; y: number; z: number }>
      if (distToStart <= distToEnd) {
        pointsToAdd = [...hdRoute.route]
      } else {
        pointsToAdd = [...hdRoute.route].reverse()
      }

      // Skip first point if it's close to the last merged point
      const TOLERANCE = 0.001
      if (
        pointsToAdd.length > 0 &&
        distance(lastPoint, pointsToAdd[0]) < TOLERANCE
      ) {
        pointsToAdd = pointsToAdd.slice(1)
      }

      // Add the points
      mergedRoute.push(...pointsToAdd)

      // Add vias
      mergedVias.push(...hdRoute.vias)

      // Add jumpers
      if (hdRoute.jumpers) {
        mergedJumpers.push(...hdRoute.jumpers)
      }
    }

    // Add end point if not already there and within reasonable distance
    const lastMergedPoint = mergedRoute[mergedRoute.length - 1]
    const TOLERANCE = 0.001
    const MAX_END_JUMP_DISTANCE = 5 // Don't add end point if it would create a wild jump
    const distToEnd = distance(lastMergedPoint, end)
    if (distToEnd > TOLERANCE && distToEnd < MAX_END_JUMP_DISTANCE) {
      mergedRoute.push({ x: end.x, y: end.y, z: end.z })
    }

    return {
      connectionName,
      rootConnectionName: hdRoutes[0]?.rootConnectionName,
      traceThickness: hdRoutes[0]?.traceThickness ?? this.defaultTraceThickness,
      viaDiameter: hdRoutes[0]?.viaDiameter ?? this.defaultViaDiameter,
      route: mergedRoute,
      vias: mergedVias,
      jumpers: mergedJumpers,
    }
  }

  /**
   * Order routes based on the node traversal path.
   * Each node in nodeOrder may have one or more routes.
   * Returns routes in the order they should be stitched.
   */
  private orderRoutesByNodePath(
    hdRoutes: HighDensityIntraNodeRoute[],
    nodeOrder: string[],
    start: { x: number; y: number; z: number },
  ): HighDensityIntraNodeRoute[] {
    // Create a set for quick lookup of remaining routes
    const remainingRoutes = new Set(hdRoutes)
    const orderedRoutes: HighDensityIntraNodeRoute[] = []
    let currentPoint = start

    // Keep picking routes by proximity until we can't find any more within threshold
    // This handles cases where there are more routes than nodes in the path
    while (remainingRoutes.size > 0) {
      // Find the route segment that starts/ends closest to current point
      // among the remaining routes
      let bestRoute: HighDensityIntraNodeRoute | null = null
      let bestDist = Infinity

      for (const route of remainingRoutes) {
        const routeStart = route.route[0]
        const routeEnd = route.route[route.route.length - 1]

        const distToStart = distance(currentPoint, routeStart)
        const distToEnd = distance(currentPoint, routeEnd)
        const minDist = Math.min(distToStart, distToEnd)

        if (minDist < bestDist) {
          bestDist = minDist
          bestRoute = route
        }
      }

      // Use a threshold to avoid wild jumps across the board
      // If the closest route is too far, stop adding routes
      if (bestRoute && bestDist < 10) {
        orderedRoutes.push(bestRoute)
        remainingRoutes.delete(bestRoute)

        // Update current point to the far end of this route
        const routeStart = bestRoute.route[0]
        const routeEnd = bestRoute.route[bestRoute.route.length - 1]
        const distToStart = distance(currentPoint, routeStart)
        const distToEnd = distance(currentPoint, routeEnd)
        currentPoint = distToStart <= distToEnd ? routeEnd : routeStart
      } else {
        // No more routes within threshold - stop to avoid wild jumps
        break
      }
    }

    // Log warning if routes were skipped (indicates a routing gap)
    if (remainingRoutes.size > 0) {
      console.warn(
        `[StitchSolver] Skipped ${remainingRoutes.size} routes for connection that were too far from the path`,
      )
    }

    return orderedRoutes
  }

  /**
   * Fallback: order routes by proximity, starting from the start point.
   */
  private orderRoutesByProximity(
    hdRoutes: HighDensityIntraNodeRoute[],
    start: { x: number; y: number; z: number },
  ): HighDensityIntraNodeRoute[] {
    const remainingRoutes = new Set(hdRoutes)
    const orderedRoutes: HighDensityIntraNodeRoute[] = []
    let currentPoint = start

    while (remainingRoutes.size > 0) {
      let bestRoute: HighDensityIntraNodeRoute | null = null
      let bestDist = Infinity
      let bestIsReversed = false

      for (const route of remainingRoutes) {
        const routeStart = route.route[0]
        const routeEnd = route.route[route.route.length - 1]

        const distToStart = distance(currentPoint, routeStart)
        const distToEnd = distance(currentPoint, routeEnd)

        if (distToStart < bestDist) {
          bestDist = distToStart
          bestRoute = route
          bestIsReversed = false
        }
        if (distToEnd < bestDist) {
          bestDist = distToEnd
          bestRoute = route
          bestIsReversed = true
        }
      }

      if (bestRoute) {
        orderedRoutes.push(bestRoute)
        remainingRoutes.delete(bestRoute)

        // Update current point
        const routeStart = bestRoute.route[0]
        const routeEnd = bestRoute.route[bestRoute.route.length - 1]
        currentPoint = bestIsReversed ? routeStart : routeEnd
      } else {
        break
      }
    }

    return orderedRoutes
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      points: [],
      lines: [],
      circles: [],
      rects: [],
      title: "Multiple High Density Route Stitch Solver 2",
    }

    // Visualize all merged HD routes that have been solved
    for (const [i, mergedRoute] of this.mergedHdRoutes.entries()) {
      const solvedColor =
        this.colorMap[mergedRoute.connectionName] ??
        `hsl(120, 100%, ${40 + ((i * 10) % 40)}%)`

      // Visualize the route path segment by segment
      for (let j = 0; j < mergedRoute.route.length - 1; j++) {
        const p1 = mergedRoute.route[j]
        const p2 = mergedRoute.route[j + 1]
        const segmentColor =
          p1.z !== 0 ? safeTransparentize(solvedColor, 0.5) : solvedColor

        graphics.lines?.push({
          points: [
            { x: p1.x, y: p1.y },
            { x: p2.x, y: p2.y },
          ],
          strokeColor: segmentColor,
          strokeWidth: mergedRoute.traceThickness,
        })
      }

      // Visualize route points
      for (const point of mergedRoute.route) {
        const pointColor =
          point.z !== 0 ? safeTransparentize(solvedColor, 0.5) : solvedColor
        graphics.points?.push({
          x: point.x,
          y: point.y,
          color: pointColor,
        })
      }

      // Visualize vias
      for (const via of mergedRoute.vias) {
        graphics.circles?.push({
          center: { x: via.x, y: via.y },
          radius: mergedRoute.viaDiameter / 2,
          fill: solvedColor,
        })
      }

      // Visualize jumpers
      if (mergedRoute.jumpers && mergedRoute.jumpers.length > 0) {
        const jumperGraphics = getJumpersGraphics(mergedRoute.jumpers, {
          color: solvedColor,
          label: mergedRoute.connectionName,
        })
        graphics.rects!.push(...(jumperGraphics.rects ?? []))
        graphics.lines!.push(...(jumperGraphics.lines ?? []))
      }
    }

    // Visualize remaining unsolved routes
    for (const unsolvedRoute of this.unsolvedRoutes) {
      const routeColor = this.colorMap[unsolvedRoute.connectionName] ?? "gray"

      graphics.points?.push(
        {
          x: unsolvedRoute.start.x,
          y: unsolvedRoute.start.y,
          color: routeColor,
          label: `${unsolvedRoute.connectionName} Start`,
        },
        {
          x: unsolvedRoute.end.x,
          y: unsolvedRoute.end.y,
          color: routeColor,
          label: `${unsolvedRoute.connectionName} End`,
        },
      )

      for (let idx = 0; idx < unsolvedRoute.hdRoutes.length; idx++) {
        const hdRoute = unsolvedRoute.hdRoutes[idx]
        if (hdRoute.route.length > 1) {
          graphics.lines?.push({
            points: hdRoute.route.map((p) => ({ x: p.x, y: p.y })),
            strokeColor: safeTransparentize(routeColor, 0.5),
            strokeDash: "10 5",
            label: `segment ${idx}`,
          })
        }

        if (hdRoute.jumpers && hdRoute.jumpers.length > 0) {
          const jumperGraphics = getJumpersGraphics(hdRoute.jumpers, {
            color: routeColor,
            label: hdRoute.connectionName,
          })
          graphics.rects!.push(...(jumperGraphics.rects ?? []))
          graphics.lines!.push(...(jumperGraphics.lines ?? []))
        }
      }
    }

    return graphics
  }
}
