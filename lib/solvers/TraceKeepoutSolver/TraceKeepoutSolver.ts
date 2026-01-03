import { BaseSolver } from "../BaseSolver"
import { HighDensityRoute } from "lib/types/high-density-types"
import { Obstacle, SimpleRouteJson } from "lib/types"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { GraphicsObject } from "graphics-debug"
import {
  computeDrawPositionFromCollisions,
  Segment,
} from "./computeDrawPositionFromCollisions"
import {
  obstacleToSegments,
  routeToOutlineSegmentsNearPoint,
} from "./obstacleToSegments"
import {
  distance,
  pointToSegmentClosestPoint,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import { smoothHdRoutes } from "./smoothLines"
import { cloneAndShuffleArray } from "lib/utils/cloneAndShuffleArray"
import { removeSelfIntersections } from "./removeSelfIntersections"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"

const BOARD_OUTLINE_CONNECTION_NAME = "__board_outline__"

interface Point2D {
  x: number
  y: number
}

interface Point3D extends Point2D {
  z: number
}

export interface TraceKeepoutSolverInput {
  hdRoutes: HighDensityRoute[]
  obstacles: Obstacle[]
  connMap: ConnectivityMap
  colorMap: Record<string, string>
  keepoutRadiusSchedule?: number[]
  srj?: Pick<SimpleRouteJson, "outline" | "bounds" | "layerCount">
}

/**
 * TraceKeepoutSolver adjusts traces to maintain keepout distance from obstacles
 * and non-connected traces. It works by walking along each trace with a cursor,
 * detecting obstacles within a keepout radius, and pushing the draw position
 * orthogonally to avoid them.
 *
 * The solver processes traces through multiple passes with decreasing keepout
 * radii as defined by KEEPOUT_RADIUS_SCHEDULE.
 */
export class TraceKeepoutSolver extends BaseSolver {
  originalHdRoutes: HighDensityRoute[]
  hdRoutes: HighDensityRoute[]
  redrawnHdRoutes: HighDensityRoute[] = []

  KEEPOUT_RADIUS_SCHEDULE: number[]
  currentScheduleIndex = 0
  currentKeepoutRadius: number

  unprocessedRoutes: HighDensityRoute[] = []
  smoothedCursorRoutes: HighDensityRoute[] = []
  processedRoutes: HighDensityRoute[] = []

  // Current trace being processed
  currentTrace: HighDensityRoute | null = null
  cursorPosition: Point3D | null = null
  lastCursorPosition: Point3D | null = null
  drawPosition: Point2D | null = null
  currentTraceSegmentIndex = 0
  currentTraceSegmentT = 0 // Parameter t in [0, 1] along the current segment
  recordedDrawPositions: Point3D[] = []
  lastCollidingSegments: Segment[] = []

  obstacleSHI: ObstacleSpatialHashIndex
  hdRouteSHI: HighDensityRouteSpatialIndex
  boardOutlineRoutes: HighDensityRoute[] = []

  constructor(private input: TraceKeepoutSolverInput) {
    super()
    this.MAX_ITERATIONS = 1e6

    // Store original routes for visualization
    this.originalHdRoutes = [...input.hdRoutes]

    // Apply smoothing to routes
    // this.hdRoutes = smoothHdRoutes(input.hdRoutes, this.getSmoothDistance())
    this.hdRoutes = input.hdRoutes

    this.KEEPOUT_RADIUS_SCHEDULE = input.keepoutRadiusSchedule ?? [
      0.3, 0.5, 0.5, 0.5, 0.5, 1, 1, 1, 1,
    ]
    this.currentKeepoutRadius = this.KEEPOUT_RADIUS_SCHEDULE[0] ?? 0.15
    this.unprocessedRoutes = [...this.hdRoutes]
    this.smoothedCursorRoutes = [...this.unprocessedRoutes]

    this.obstacleSHI = new ObstacleSpatialHashIndex("flatbush", input.obstacles)

    // Create artificial hdRoutes for board outline to prevent traces from going outside
    this.boardOutlineRoutes = this.createBoardOutlineRoutes()

    // Add board outline routes to the spatial index so they act as obstacles
    // but NOT to unprocessedRoutes so they won't be processed
    this.hdRouteSHI = new HighDensityRouteSpatialIndex([
      ...this.hdRoutes,
      ...this.boardOutlineRoutes,
    ])

    // Make sure the start/endpoint of any route is properly connected in the
    // connMap to the obstacle
    for (const [
      endpoint,
      connectionName,
      rootConnectionName,
    ] of this.hdRoutes.flatMap(
      (
        r,
      ): [
        { x: number; y: number; z: number },
        string,
        string | undefined,
      ][] => [
        [r.route[0]!, r.connectionName, r.rootConnectionName],
        [r.route[r.route.length - 1]!, r.connectionName, r.rootConnectionName],
      ],
    )) {
      const obstacles = this.obstacleSHI
        .searchArea(endpoint.x, endpoint.y, 0.01, 0.01)
        .filter((o) => o.zLayers?.includes(endpoint.z))
      if (obstacles.length === 0) continue
      const obstacle = obstacles[0]!

      this.input.connMap.addConnections([
        [
          connectionName,
          rootConnectionName!,
          ...(obstacle.offBoardConnectsTo ?? []),
          obstacle.obstacleId!,
          ...obstacle.connectedTo,
        ].filter(Boolean),
      ])
    }
  }

  getSmoothDistance(): number {
    return this.currentKeepoutRadius
  }

  _step() {
    // If no current trace, dequeue one
    if (!this.currentTrace) {
      const nextTrace = this.unprocessedRoutes.shift()

      if (!nextTrace) {
        // All traces processed for this schedule pass
        // Check if there's another keepout radius in the schedule
        this.currentScheduleIndex++
        if (this.currentScheduleIndex < this.KEEPOUT_RADIUS_SCHEDULE.length) {
          // Requeue all traces with the new keepout radius
          this.currentKeepoutRadius =
            this.KEEPOUT_RADIUS_SCHEDULE[this.currentScheduleIndex]!
          this.unprocessedRoutes = cloneAndShuffleArray(
            [...this.processedRoutes],
            // smoothHdRoutes([...this.processedRoutes],this.getSmoothDistance())
            this.currentScheduleIndex,
          )
          this.smoothedCursorRoutes = [...this.unprocessedRoutes]
          this.processedRoutes = []
          // Rebuild the spatial index with processed routes (including board outline)
          this.hdRouteSHI = new HighDensityRouteSpatialIndex([
            ...this.unprocessedRoutes,
            ...this.boardOutlineRoutes,
          ])
          return
        }

        // All schedule passes complete
        this.redrawnHdRoutes = this.processedRoutes
        this.solved = true
        return
      }

      // Initialize the new trace processing
      this.currentTrace = nextTrace
      if (this.currentTrace.route.length < 2) {
        // Trace is too short to process, just pass it through
        this.processedRoutes.push(this.currentTrace)
        this.currentTrace = null
        return
      }

      const startPoint = this.currentTrace.route[0]!
      this.cursorPosition = { ...startPoint }
      this.lastCursorPosition = { ...startPoint }
      this.drawPosition = { x: startPoint.x, y: startPoint.y }
      this.currentTraceSegmentIndex = 0
      this.currentTraceSegmentT = 0
      this.recordedDrawPositions = [{ ...startPoint }]
      return
    }

    // Save last cursor position before stepping
    this.lastCursorPosition = { ...this.cursorPosition! }

    // Step the cursor forward along the trace
    const stepped = this.stepCursorForward()

    if (!stepped) {
      // Reached end of trace, finalize it
      this.finalizeCurrentTrace()
      return
    }

    // Get colliding segments for obstacles and traces
    const collidingSegments = this.getCollidingSegments(this.cursorPosition!)
    this.lastCollidingSegments = collidingSegments

    // Compute draw position using the collision avoidance algorithm
    const newDrawPosition = computeDrawPositionFromCollisions({
      cursorPosition: this.cursorPosition!,
      lastCursorPosition: this.lastCursorPosition!,
      collidingSegments,
      keepoutRadius: this.currentKeepoutRadius,
    })

    this.drawPosition = newDrawPosition ?? { ...this.cursorPosition! }

    // if (
    //   this.positionHasCollision(
    //     {
    //       ...this.drawPosition!,
    //       z: this.cursorPosition!.z,
    //     },
    //     -0.001,
    //   ) ||
    //   distance(this.drawPosition!, this.cursorPosition!) >
    //     this.currentKeepoutRadius + 0.001
    // ) {
    //   this.drawPosition = { ...this.cursorPosition! }
    // }

    // Record the draw position
    this.recordedDrawPositions.push({
      x: this.drawPosition!.x,
      y: this.drawPosition!.y,
      z: this.cursorPosition!.z,
    })
  }

  getStepDistance(): number {
    return this.currentKeepoutRadius / 2
  }

  /**
   * Steps the cursor forward by CURSOR_STEP_DISTANCE along the trace
   * Returns false if we've reached the end of the trace
   */
  private stepCursorForward(): boolean {
    if (!this.currentTrace || !this.cursorPosition) return false

    const route = this.currentTrace.route
    let remainingDistance = this.getStepDistance()

    while (remainingDistance > 0) {
      if (this.currentTraceSegmentIndex >= route.length - 1) {
        // Reached end of trace
        return false
      }

      const segStart = route[this.currentTraceSegmentIndex]!
      const segEnd = route[this.currentTraceSegmentIndex + 1]!

      const segDx = segEnd.x - segStart.x
      const segDy = segEnd.y - segStart.y
      const segLength = Math.sqrt(segDx * segDx + segDy * segDy)

      if (segLength === 0) {
        // Zero-length segment, skip it
        this.currentTraceSegmentIndex++
        this.currentTraceSegmentT = 0
        continue
      }

      // How far we are into this segment
      const currentDistInSeg = this.currentTraceSegmentT * segLength
      const distToSegEnd = segLength - currentDistInSeg

      if (remainingDistance <= distToSegEnd) {
        // We can complete the step within this segment
        const newDistInSeg = currentDistInSeg + remainingDistance
        this.currentTraceSegmentT = newDistInSeg / segLength

        // Update cursor position
        this.cursorPosition = {
          x: segStart.x + segDx * this.currentTraceSegmentT,
          y: segStart.y + segDy * this.currentTraceSegmentT,
          z: segStart.z, // Stay on same layer within segment
        }

        return true
      } else {
        // Step goes beyond this segment
        remainingDistance -= distToSegEnd
        this.currentTraceSegmentIndex++
        this.currentTraceSegmentT = 0

        if (this.currentTraceSegmentIndex >= route.length - 1) {
          // Reached end of trace
          const lastPoint = route[route.length - 1]!
          this.cursorPosition = { ...lastPoint }
          return false
        }
      }
    }

    return true
  }

  /**
   * Gets all colliding segments (obstacle edges and trace outlines) within the keepout radius
   */
  private getCollidingSegments(position: {
    x: number
    y: number
    z: number
  }): Segment[] {
    if (!this.currentTrace) return []

    const rootConnectionName =
      this.currentTrace.rootConnectionName ?? this.currentTrace.connectionName
    const searchRadius = this.currentKeepoutRadius * 2
    const segments: Segment[] = []

    // Check for obstacles within the keepout radius
    const nearbyObstacles = this.obstacleSHI.searchArea(
      position.x,
      position.y,
      searchRadius,
      searchRadius,
    )

    // Filter to non-connected obstacles on the same layer and convert to segments
    for (const obstacle of nearbyObstacles) {
      // Check if obstacle is on the same layer
      if (obstacle.zLayers && !obstacle.zLayers.includes(position.z)) {
        continue
      }

      // Check if obstacle is connected to this trace's net
      if (obstacle.connectedTo.includes(rootConnectionName)) {
        continue
      }

      // Check if obstacle's own ID is connected
      if (
        obstacle.obstacleId &&
        this.input.connMap.areIdsConnected(
          rootConnectionName,
          obstacle.obstacleId,
        )
      ) {
        continue
      }

      // Check connectivity via connMap
      let isConnected = false
      for (const connectedId of obstacle.connectedTo) {
        if (
          this.input.connMap.areIdsConnected(rootConnectionName, connectedId)
        ) {
          isConnected = true
          break
        }
      }
      if (isConnected) continue

      // Convert obstacle to edge segments
      segments.push(...obstacleToSegments(obstacle))
    }

    // Check for non-connected traces within the keepout radius
    const nearbyRoutes = this.hdRouteSHI.getConflictingRoutesNearPoint(
      { x: position.x, y: position.y },
      searchRadius,
    )

    for (const { conflictingRoute } of nearbyRoutes) {
      const routeRootName =
        conflictingRoute.rootConnectionName ?? conflictingRoute.connectionName

      // Don't avoid our own trace
      if (routeRootName === rootConnectionName) {
        continue
      }

      // Check connectivity
      if (
        this.input.connMap.areIdsConnected(rootConnectionName, routeRootName)
      ) {
        continue
      }

      // Convert route to outline segments (considering trace width)
      // Only include segments that are within the search area
      const traceWidth = conflictingRoute.traceThickness ?? 0.15
      segments.push(
        ...routeToOutlineSegmentsNearPoint(
          conflictingRoute.route,
          traceWidth,
          { x: position.x, y: position.y },
          searchRadius,
        ),
      )
    }

    return segments
  }

  positionHasCollision(
    position: {
      x: number
      y: number
      z: number
    },
    margin: number = 0,
  ): boolean {
    const collidingSegments = this.getCollidingSegments(position)

    for (const segment of collidingSegments) {
      if (
        pointToSegmentDistance(position, segment.start, segment.end) <=
        this.currentKeepoutRadius + margin
      ) {
        return true
      }
    }
    return false
  }

  /**
   * Finalizes the current trace with the recorded draw positions
   */
  private finalizeCurrentTrace() {
    if (!this.currentTrace) return

    // Add the final point if not already there
    const lastRoutePoint =
      this.currentTrace.route[this.currentTrace.route.length - 1]!
    const lastRecorded =
      this.recordedDrawPositions[this.recordedDrawPositions.length - 1]
    if (
      !lastRecorded ||
      lastRecorded.x !== lastRoutePoint.x ||
      lastRecorded.y !== lastRoutePoint.y
    ) {
      this.recordedDrawPositions.push({ ...lastRoutePoint })
    }

    // Simplify the recorded positions to remove redundant points
    const simplifiedRoute = this.simplifyRoute(this.recordedDrawPositions)

    // Remove any self-intersections from the route
    const cleanedRoute = removeSelfIntersections(simplifiedRoute)

    // Create the redrawn trace
    const redrawnTrace: HighDensityRoute = {
      connectionName: this.currentTrace.connectionName,
      rootConnectionName: this.currentTrace.rootConnectionName,
      traceThickness: this.currentTrace.traceThickness,
      viaDiameter: this.currentTrace.viaDiameter,
      route: cleanedRoute,
      vias: [...this.currentTrace.vias], // Keep vias unchanged
      // Preserve jumpers from original route
      jumpers: this.currentTrace.jumpers,
    }

    this.processedRoutes.push(redrawnTrace)
    this.currentTrace = null
    this.cursorPosition = null
    this.lastCursorPosition = null
    this.drawPosition = null
    this.recordedDrawPositions = []
  }

  /**
   * Simplifies the route by removing collinear points
   */
  private simplifyRoute(points: Point3D[]): Point3D[] {
    if (points.length <= 2) return points

    const result: Point3D[] = [points[0]!]

    for (let i = 1; i < points.length - 1; i++) {
      const prev = result[result.length - 1]!
      const curr = points[i]!
      const next = points[i + 1]!

      // Skip points where z changes - always keep layer transitions
      if (curr.z !== prev.z || curr.z !== next.z) {
        result.push(curr)
        continue
      }

      // Check if the point is collinear with prev and next
      const dx1 = curr.x - prev.x
      const dy1 = curr.y - prev.y
      const dx2 = next.x - curr.x
      const dy2 = next.y - curr.y

      // Cross product to check collinearity
      const cross = dx1 * dy2 - dy1 * dx2
      const epsilon = 1e-6

      if (Math.abs(cross) > epsilon) {
        // Not collinear, keep this point
        result.push(curr)
      }
    }

    result.push(points[points.length - 1]!)
    return result
  }

  /**
   * Creates artificial hdRoutes representing the board outline.
   * These routes act as obstacles to prevent traces from being pushed outside the board.
   */
  private createBoardOutlineRoutes(): HighDensityRoute[] {
    const routes: HighDensityRoute[] = []

    // If no srj is provided, don't create board outline routes
    if (!this.input.srj) {
      return routes
    }

    const { outline, bounds } = this.input.srj

    // Get the outline points - use outline if available, otherwise create from bounds
    let outlinePoints: Array<{ x: number; y: number }>

    if (outline && outline.length >= 3) {
      outlinePoints = outline
    } else {
      // Create outline from bounds
      outlinePoints = [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.maxY },
      ]
    }

    // Create a route for each edge of the outline (on all layers)
    // We create separate routes for each edge so the spatial index can find them efficiently
    // Each route needs a unique connection name for the spatial index
    const layerCount = this.input.srj.layerCount ?? 2
    for (let i = 0; i < outlinePoints.length; i++) {
      const start = outlinePoints[i]!
      const end = outlinePoints[(i + 1) % outlinePoints.length]!

      for (let layerIndex = 0; layerIndex < layerCount; layerIndex++) {
        routes.push({
          connectionName: `${BOARD_OUTLINE_CONNECTION_NAME}_${i}_z${layerIndex}`,
          traceThickness: 0.01, // Thin trace for outline
          viaDiameter: 0,
          route: [
            { x: start.x, y: start.y, z: layerIndex },
            { x: end.x, y: end.y, z: layerIndex },
          ],
          vias: [],
        })
      }
    }

    return routes
  }

  visualize(): GraphicsObject {
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
      title: `Trace Keepout Solver (radius: ${this.currentKeepoutRadius.toFixed(2)})`,
    }

    for (const route of this.originalHdRoutes) {
      if (route.route.length === 0) continue

      for (let i = 0; i < route.route.length - 1; i++) {
        const current = route.route[i]!
        const next = route.route[i + 1]!

        if (current.z === next.z) {
          visualization.lines.push({
            points: [
              { x: current.x, y: current.y },
              { x: next.x, y: next.y },
            ],
            strokeColor: "rgba(0,0,0,0.25)",
            strokeWidth: (route.traceThickness ?? 0.15) * 1.5,
          })
        }
      }
    }

    // Visualize obstacles
    for (const obstacle of this.input.obstacles) {
      let fillColor = "rgba(128, 128, 128, 0.2)"
      const isOnLayer0 = obstacle.zLayers?.includes(0)
      const isOnLayer1 = obstacle.zLayers?.includes(1)

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
        label: `Obstacle (Z: ${obstacle.zLayers?.join(", ")})`,
      })
    }

    // Draw board outline
    if (this.input.srj) {
      const { outline, bounds } = this.input.srj
      let outlinePoints: Array<{ x: number; y: number }>

      if (outline && outline.length >= 3) {
        outlinePoints = outline
      } else {
        // Create outline from bounds
        outlinePoints = [
          { x: bounds.minX, y: bounds.minY },
          { x: bounds.maxX, y: bounds.minY },
          { x: bounds.maxX, y: bounds.maxY },
          { x: bounds.minX, y: bounds.maxY },
        ]
      }

      // Draw each edge of the outline
      for (let i = 0; i < outlinePoints.length; i++) {
        const start = outlinePoints[i]!
        const end = outlinePoints[(i + 1) % outlinePoints.length]!

        visualization.lines.push({
          points: [
            { x: start.x, y: start.y },
            { x: end.x, y: end.y },
          ],
          strokeColor: "rgba(0, 128, 0, 0.6)",
          strokeWidth: 0.1,
          label: "Board outline",
        })
      }
    }

    // Draw processed routes
    for (const route of this.processedRoutes) {
      if (route.route.length === 0) continue

      const color = this.input.colorMap[route.connectionName] || "#888888"

      for (let i = 0; i < route.route.length - 1; i++) {
        const current = route.route[i]!
        const next = route.route[i + 1]!

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
          color,
          label: route.connectionName,
        })
        visualization.rects.push(...(jumperGraphics.rects ?? []))
        visualization.lines.push(...(jumperGraphics.lines ?? []))
      }
    }

    // Draw current trace being processed (if any)
    if (this.currentTrace && this.recordedDrawPositions.length > 0) {
      const color =
        this.input.colorMap[this.currentTrace.connectionName] || "#00FF00"

      for (let i = 0; i < this.recordedDrawPositions.length - 1; i++) {
        const current = this.recordedDrawPositions[i]!
        const next = this.recordedDrawPositions[i + 1]!

        visualization.lines.push({
          points: [
            { x: current.x, y: current.y },
            { x: next.x, y: next.y },
          ],
          strokeColor: "green",
          strokeWidth: this.currentTrace.traceThickness,
        })
      }

      // Draw cursor position
      if (this.cursorPosition) {
        visualization.circles.push({
          center: { x: this.cursorPosition.x, y: this.cursorPosition.y },
          radius: this.currentKeepoutRadius,
          stroke: "orange",
          fill: "none",
        })

        visualization.points.push({
          x: this.cursorPosition.x,
          y: this.cursorPosition.y,
          color: "orange",
          label: "Cursor",
        })

        // Draw projected segment (used for clearance calculation)
        if (this.lastCursorPosition) {
          const tdx = this.cursorPosition.x - this.lastCursorPosition.x
          const tdy = this.cursorPosition.y - this.lastCursorPosition.y
          const tLen = Math.sqrt(tdx * tdx + tdy * tdy)
          const epsilon = 0.0001
          const traceDir =
            tLen > epsilon ? { x: tdx / tLen, y: tdy / tLen } : { x: 1, y: 0 }

          const halfLength = this.currentKeepoutRadius / 4
          const projectedStart = {
            x: this.cursorPosition.x - traceDir.x * halfLength,
            y: this.cursorPosition.y - traceDir.y * halfLength,
          }
          const projectedEnd = {
            x: this.cursorPosition.x + traceDir.x * halfLength,
            y: this.cursorPosition.y + traceDir.y * halfLength,
          }

          visualization.lines.push({
            points: [projectedStart, projectedEnd],
            strokeColor: "cyan",
            strokeWidth: 0.05,
            label: "Projected segment",
          })
        }
      }

      // Draw draw position
      if (this.drawPosition) {
        visualization.points.push({
          x: this.drawPosition.x,
          y: this.drawPosition.y,
          color: "lime",
          label: "Draw",
        })
      }

      // Draw colliding segments
      for (const segment of this.lastCollidingSegments) {
        visualization.lines.push({
          points: [
            { x: segment.start.x, y: segment.start.y },
            { x: segment.end.x, y: segment.end.y },
          ],
          strokeColor: "rgba(255, 0, 255, 0.8)",
          strokeWidth: 0.02,
          label: "Colliding segment",
        })
      }
    }

    if (!this.solved) {
      // Draw smoothed routes (these are what the solver will process)
      for (const route of this.smoothedCursorRoutes) {
        if (route.route.length === 0) continue

        for (let i = 0; i < route.route.length - 1; i++) {
          const current = route.route[i]!
          const next = route.route[i + 1]!

          if (current.z === next.z) {
            visualization.lines.push({
              points: [
                { x: current.x, y: current.y },
                { x: next.x, y: next.y },
              ],
              strokeColor: "gray",
            })
          }
        }
      }
    }

    return visualization
  }

  /** Returns the redrawn routes. This is the primary output of the solver. */
  getRedrawnHdRoutes(): HighDensityRoute[] {
    return this.redrawnHdRoutes
  }
}
