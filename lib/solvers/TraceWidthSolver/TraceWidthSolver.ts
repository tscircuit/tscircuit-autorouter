import { BaseSolver } from "../BaseSolver"
import { HighDensityRoute } from "lib/types/high-density-types"
import { Obstacle, SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { GraphicsObject } from "graphics-debug"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"

const CURSOR_STEP_DISTANCE = 0.1

interface Point2D {
  x: number
  y: number
}

interface Point3D extends Point2D {
  z: number
}

export interface TraceWidthSolverInput {
  hdRoutes: HighDensityRoute[]
  connection: SimpleRouteConnection[]
  obstacles?: Obstacle[]
  connMap?: ConnectivityMap
  colorMap?: Record<string, string>
  minTraceWidth: number
  obstacleMargin?: number
}

/**
 * TraceWidthSolver determines the optimal trace width for each route.
 * It uses a TRACE_WIDTH_SCHEDULE to try progressively narrower widths:
 * [nominalTraceWidth, (nominalTraceWidth + minTraceWidth)/2, minTraceWidth]
 *
 * For each trace, it walks along with a cursor checking clearance.
 * If clearance is insufficient for the current width, it tries the next
 * narrower width in the schedule.
 *
 * It only runs width adjustments for routes whose connection provides a
 * nominalTraceWidth; routes without one are passed through unchanged.
 * The schedule is built per-route from that connection's nominalTraceWidth.
 */
export class TraceWidthSolver extends BaseSolver {
  override getSolverName(): string {
    return "TraceWidthSolver"
  }

  hdRoutes: HighDensityRoute[]
  hdRoutesWithWidths: HighDensityRoute[] = []

  nominalTraceWidth: number
  minTraceWidth: number
  obstacleMargin: number
  TRACE_WIDTH_SCHEDULE: number[]
  connectionNominalTraceWidthMap: Map<string, number>

  unprocessedRoutes: HighDensityRoute[] = []
  processedRoutes: HighDensityRoute[] = []

  // Current trace being processed
  currentTrace: HighDensityRoute | null = null
  cursorPosition: Point3D | null = null
  currentTraceSegmentIndex = 0
  currentTraceSegmentT = 0
  currentScheduleIndex = 0
  currentTargetWidth: number = 0
  hasInsufficientClearance = false

  // For visualization - track colliding objects
  lastCollidingObstacles: Obstacle[] = []
  lastCollidingRoutes: HighDensityRoute[] = []
  lastClearance: number = Infinity

  obstacles: Obstacle[] = []
  obstacleSHI?: ObstacleSpatialHashIndex
  hdRouteSHI: HighDensityRouteSpatialIndex
  connMap?: ConnectivityMap
  colorMap?: Record<string, string>

  constructor(input: TraceWidthSolverInput) {
    super()
    this.MAX_ITERATIONS = 1e6

    this.hdRoutes = [...input.hdRoutes]
    this.minTraceWidth = input.minTraceWidth
    this.obstacleMargin = input.obstacleMargin ?? 0.15
    this.nominalTraceWidth = 0
    this.TRACE_WIDTH_SCHEDULE = []

    this.unprocessedRoutes = [...this.hdRoutes]
    this.connMap = input.connMap
    this.colorMap = input.colorMap
    this.obstacles = input.obstacles ?? []
    this.connectionNominalTraceWidthMap = new Map()

    for (const connection of input.connection) {
      if (connection.nominalTraceWidth === undefined) {
        continue
      }
      this.connectionNominalTraceWidthMap.set(
        connection.name,
        connection.nominalTraceWidth,
      )
    }

    if (this.obstacles.length > 0) {
      this.obstacleSHI = new ObstacleSpatialHashIndex(
        "flatbush",
        this.obstacles,
      )
    }

    this.hdRouteSHI = new HighDensityRouteSpatialIndex(this.hdRoutes)
  }

  private getNominalTraceWidthForRoute(
    route: HighDensityRoute,
  ): number | undefined {
    const byName = this.connectionNominalTraceWidthMap.get(route.connectionName)
    if (byName !== undefined) {
      return byName
    }
    if (route.rootConnectionName) {
      return this.connectionNominalTraceWidthMap.get(route.rootConnectionName)
    }
    return undefined
  }

  _step() {
    // If no current trace, dequeue one
    if (!this.currentTrace) {
      const nextTrace = this.unprocessedRoutes.shift()

      if (!nextTrace) {
        // All traces processed
        this.hdRoutesWithWidths = this.processedRoutes
        this.solved = true
        return
      }

      // Initialize the new trace processing
      const nominalTraceWidth = this.getNominalTraceWidthForRoute(nextTrace)
      if (nominalTraceWidth === undefined) {
        this.processedRoutes.push({ ...nextTrace })
        this.currentTrace = null
        return
      }

      this.currentTrace = nextTrace
      this.nominalTraceWidth = nominalTraceWidth
      const midWidth = (this.nominalTraceWidth + this.minTraceWidth) / 2
      this.TRACE_WIDTH_SCHEDULE = [this.nominalTraceWidth, midWidth]
      if (this.currentTrace.route.length < 2) {
        // Trace is too short to process, just pass it through with minTraceWidth
        this.processedRoutes.push({
          ...this.currentTrace,
          traceThickness: this.minTraceWidth,
        })
        this.currentTrace = null
        return
      }

      // Start with the widest width in the schedule
      this.currentScheduleIndex = 0
      this.currentTargetWidth = this.TRACE_WIDTH_SCHEDULE[0]!
      this.initializeCursor()
      return
    }

    // Step the cursor forward along the trace
    const stepped = this.stepCursorForward()

    if (!stepped) {
      // Reached end of trace without collision - this width works!
      // Use this width and finalize immediately (widest possible that fits)
      this.finalizeCurrentTrace(this.currentTargetWidth)
      return
    }

    // Check clearance at current cursor position
    const clearance = this.getClearanceAtPosition(this.cursorPosition!)

    // Check if there's enough clearance for the current target width + obstacle margin
    const requiredClearance = this.currentTargetWidth / 2 + this.obstacleMargin
    if (clearance < requiredClearance) {
      // Collision found - this width doesn't work, try the next narrower width
      this.hasInsufficientClearance = true
      this.currentScheduleIndex++

      if (this.currentScheduleIndex < this.TRACE_WIDTH_SCHEDULE.length) {
        // Try the next width in the schedule
        this.currentTargetWidth =
          this.TRACE_WIDTH_SCHEDULE[this.currentScheduleIndex]!
        this.initializeCursor()
      } else {
        // Exhausted all widths in schedule, use minTraceWidth as fallback
        this.finalizeCurrentTrace(this.minTraceWidth)
      }
    }
  }

  /**
   * Initializes/resets the cursor for processing a trace
   */
  private initializeCursor() {
    if (!this.currentTrace) return
    const startPoint = this.currentTrace.route[0]!
    this.cursorPosition = { ...startPoint }
    this.currentTraceSegmentIndex = 0
    this.currentTraceSegmentT = 0
    this.hasInsufficientClearance = false
  }

  /**
   * Steps the cursor forward by CURSOR_STEP_DISTANCE along the trace
   * Returns false if we've reached the end of the trace
   * Skips segments where both endpoints are inside jumper pads
   */
  private stepCursorForward(): boolean {
    if (!this.currentTrace || !this.cursorPosition) return false

    const route = this.currentTrace.route
    let remainingDistance = CURSOR_STEP_DISTANCE

    while (remainingDistance > 0) {
      if (this.currentTraceSegmentIndex >= route.length - 1) {
        return false
      }

      const segStart = route[this.currentTraceSegmentIndex]!
      const segEnd = route[this.currentTraceSegmentIndex + 1]!

      // Skip segments entirely inside jumper pads
      if (segStart.insideJumperPad && segEnd.insideJumperPad) {
        this.currentTraceSegmentIndex++
        this.currentTraceSegmentT = 0
        continue
      }

      const segDx = segEnd.x - segStart.x
      const segDy = segEnd.y - segStart.y
      const segLength = Math.sqrt(segDx * segDx + segDy * segDy)

      if (segLength === 0) {
        this.currentTraceSegmentIndex++
        this.currentTraceSegmentT = 0
        continue
      }

      const currentDistInSeg = this.currentTraceSegmentT * segLength
      const distToSegEnd = segLength - currentDistInSeg

      if (remainingDistance <= distToSegEnd) {
        const newDistInSeg = currentDistInSeg + remainingDistance
        this.currentTraceSegmentT = newDistInSeg / segLength

        this.cursorPosition = {
          x: segStart.x + segDx * this.currentTraceSegmentT,
          y: segStart.y + segDy * this.currentTraceSegmentT,
          z: segStart.z,
        }

        return true
      } else {
        remainingDistance -= distToSegEnd
        this.currentTraceSegmentIndex++
        this.currentTraceSegmentT = 0

        if (this.currentTraceSegmentIndex >= route.length - 1) {
          const lastPoint = route[route.length - 1]!
          this.cursorPosition = { ...lastPoint }
          return false
        }
      }
    }

    return true
  }

  /**
   * Checks if an obstacle is a jumper pad belonging to the current trace's jumpers.
   * This is needed because jumper pads may not have connectedTo set properly.
   */
  private isObstacleOwnJumperPad(obstacle: Obstacle): boolean {
    if (!this.currentTrace?.jumpers) return false

    const TOLERANCE = 0.01 // 0.01mm tolerance for position matching

    for (const jumper of this.currentTrace.jumpers) {
      // Check if obstacle center is near jumper start or end
      const distToStart = Math.sqrt(
        (obstacle.center.x - jumper.start.x) ** 2 +
          (obstacle.center.y - jumper.start.y) ** 2,
      )
      const distToEnd = Math.sqrt(
        (obstacle.center.x - jumper.end.x) ** 2 +
          (obstacle.center.y - jumper.end.y) ** 2,
      )

      // Jumper pads are typically small rectangles at the start/end of jumpers
      // Check if obstacle center is within half the pad width of the jumper endpoint
      const maxDist = Math.max(obstacle.width, obstacle.height) / 2 + TOLERANCE
      if (distToStart < maxDist || distToEnd < maxDist) {
        return true
      }
    }

    return false
  }

  /**
   * Gets the minimum clearance at a given position from obstacles and other traces
   * Also updates lastCollidingObstacles and lastCollidingRoutes for visualization
   */
  private getClearanceAtPosition(position: Point3D): number {
    if (!this.currentTrace) return Infinity

    const rootConnectionName =
      this.currentTrace.rootConnectionName ?? this.currentTrace.connectionName
    const searchRadius = this.nominalTraceWidth * 2
    let minClearance = Infinity

    // Reset colliding objects for visualization
    this.lastCollidingObstacles = []
    this.lastCollidingRoutes = []

    // Check for obstacles within the search radius
    if (this.obstacleSHI) {
      const nearbyObstacles = this.obstacleSHI.searchArea(
        position.x,
        position.y,
        searchRadius,
        searchRadius,
      )

      for (const obstacle of nearbyObstacles) {
        if (obstacle.zLayers && !obstacle.zLayers.includes(position.z)) {
          continue
        }

        if (obstacle.connectedTo.includes(rootConnectionName)) {
          continue
        }

        if (
          obstacle.obstacleId &&
          this.connMap?.areIdsConnected(rootConnectionName, obstacle.obstacleId)
        ) {
          continue
        }

        let isConnected = false
        if (this.connMap) {
          for (const connectedId of obstacle.connectedTo) {
            if (this.connMap.areIdsConnected(rootConnectionName, connectedId)) {
              isConnected = true
              break
            }
          }
        }
        if (isConnected) continue

        // Skip obstacles that are jumper pads belonging to this trace
        if (this.isObstacleOwnJumperPad(obstacle)) {
          continue
        }

        const obstacleMinX = obstacle.center.x - obstacle.width / 2
        const obstacleMaxX = obstacle.center.x + obstacle.width / 2
        const obstacleMinY = obstacle.center.y - obstacle.height / 2
        const obstacleMaxY = obstacle.center.y + obstacle.height / 2

        const dx = Math.max(
          obstacleMinX - position.x,
          0,
          position.x - obstacleMaxX,
        )
        const dy = Math.max(
          obstacleMinY - position.y,
          0,
          position.y - obstacleMaxY,
        )
        const distToObstacle = Math.sqrt(dx * dx + dy * dy)

        // Track obstacles that would violate clearance (width/2 + margin)
        const requiredObstacleClearance =
          this.currentTargetWidth / 2 + this.obstacleMargin
        if (distToObstacle < requiredObstacleClearance) {
          this.lastCollidingObstacles.push(obstacle)
        }

        if (distToObstacle < minClearance) {
          minClearance = distToObstacle
        }
      }
    }

    // Check for non-connected traces within the search radius
    const nearbyRoutes = this.hdRouteSHI.getConflictingRoutesNearPoint(
      { x: position.x, y: position.y, z: position.z },
      searchRadius,
    )

    for (const { conflictingRoute, distance } of nearbyRoutes) {
      const routeRootName =
        conflictingRoute.rootConnectionName ?? conflictingRoute.connectionName

      if (routeRootName === rootConnectionName) {
        continue
      }

      if (this.connMap?.areIdsConnected(rootConnectionName, routeRootName)) {
        continue
      }

      const otherTraceHalfWidth = (conflictingRoute.traceThickness ?? 0.15) / 2
      const clearance = distance - otherTraceHalfWidth

      // Track routes that would violate clearance (width/2 + margin)
      const requiredTraceClearance =
        this.currentTargetWidth / 2 + this.obstacleMargin
      if (clearance < requiredTraceClearance) {
        this.lastCollidingRoutes.push(conflictingRoute)
      }

      if (clearance < minClearance) {
        minClearance = clearance
      }
    }

    this.lastClearance = minClearance
    return minClearance
  }

  /**
   * Finalizes the current trace with the given width
   */
  private finalizeCurrentTrace(traceWidth: number) {
    if (!this.currentTrace) return

    const routeWithWidth: HighDensityRoute = {
      connectionName: this.currentTrace.connectionName,
      rootConnectionName: this.currentTrace.rootConnectionName,
      traceThickness: traceWidth,
      viaDiameter: this.currentTrace.viaDiameter,
      route: [...this.currentTrace.route],
      vias: [...this.currentTrace.vias],
      // Preserve jumpers from original route
      jumpers: this.currentTrace.jumpers,
    }

    this.processedRoutes.push(routeWithWidth)
    this.currentTrace = null
    this.cursorPosition = null
    this.hasInsufficientClearance = false
  }

  visualize(): GraphicsObject {
    const scheduleStr = this.TRACE_WIDTH_SCHEDULE.map((w) => w.toFixed(2)).join(
      ", ",
    )

    const visualization: GraphicsObject & {
      lines: NonNullable<GraphicsObject["lines"]>
      points: NonNullable<GraphicsObject["points"]>
      circles: NonNullable<GraphicsObject["circles"]>
      rects: NonNullable<GraphicsObject["rects"]>
    } = {
      lines: [],
      points: [],
      circles: [],
      rects: [],
      coordinateSystem: "cartesian",
      title: `Trace Width Solver (schedule: [${scheduleStr}]mm, fallback: ${this.minTraceWidth.toFixed(2)}mm, margin: ${this.obstacleMargin.toFixed(2)}mm)`,
    }

    // Build set of colliding obstacle IDs for quick lookup
    const collidingObstacleIds = new Set(
      this.lastCollidingObstacles.map((o) => o.obstacleId),
    )
    const collidingRouteNames = new Set(
      this.lastCollidingRoutes.map((r) => r.connectionName),
    )

    // Draw all obstacles (faded, with colliding ones highlighted)
    for (const obstacle of this.obstacles) {
      const isColliding = collidingObstacleIds.has(obstacle.obstacleId)
      const isOnLayer0 = obstacle.zLayers?.includes(0)
      const isOnLayer1 = obstacle.zLayers?.includes(1)

      let fillColor: string
      if (isColliding) {
        fillColor = "rgba(255, 0, 0, 0.6)"
      } else if (isOnLayer0 && isOnLayer1) {
        fillColor = "rgba(128, 0, 128, 0.15)"
      } else if (isOnLayer0) {
        fillColor = "rgba(255, 0, 0, 0.15)"
      } else if (isOnLayer1) {
        fillColor = "rgba(0, 0, 255, 0.15)"
      } else {
        fillColor = "rgba(128, 128, 128, 0.15)"
      }

      visualization.rects.push({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: fillColor,
        stroke: isColliding ? "red" : undefined,
        label: isColliding
          ? `COLLIDING: ${obstacle.obstacleId ?? "obstacle"}`
          : `${obstacle.obstacleId ?? "obstacle"} (Z: ${obstacle.zLayers?.join(", ")})`,
      })
    }

    // Draw processed routes with their determined widths
    for (const route of this.processedRoutes) {
      if (route.route.length === 0) continue

      const isNominalWidth = route.traceThickness === this.nominalTraceWidth
      const isMidWidth = route.traceThickness === this.TRACE_WIDTH_SCHEDULE[1]
      const strokeColor = isNominalWidth
        ? "green"
        : isMidWidth
          ? "yellow"
          : "orange"

      for (let i = 0; i < route.route.length - 1; i++) {
        const current = route.route[i]!
        const next = route.route[i + 1]!

        // Skip segments inside jumper pads (these are drawn by getJumpersGraphics)
        if (current.insideJumperPad && next.insideJumperPad) {
          continue
        }

        if (current.z === next.z) {
          visualization.lines.push({
            points: [
              { x: current.x, y: current.y },
              { x: next.x, y: next.y },
            ],
            strokeColor,
            strokeWidth: route.traceThickness,
            label: `${route.connectionName} (w=${route.traceThickness.toFixed(2)})`,
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
          color: strokeColor,
          label: route.connectionName,
        })
        visualization.rects.push(...(jumperGraphics.rects ?? []))
        visualization.lines.push(...(jumperGraphics.lines ?? []))
      }
    }

    // Draw current trace being processed (if any)
    if (this.currentTrace) {
      for (let i = 0; i < this.currentTrace.route.length - 1; i++) {
        const current = this.currentTrace.route[i]!
        const next = this.currentTrace.route[i + 1]!

        // Skip segments inside jumper pads
        if (current.insideJumperPad && next.insideJumperPad) {
          continue
        }

        if (current.z === next.z) {
          visualization.lines.push({
            points: [
              { x: current.x, y: current.y },
              { x: next.x, y: next.y },
            ],
            strokeColor: "cyan",
            strokeWidth: this.currentTrace.traceThickness ?? this.minTraceWidth,
            label: `Processing: ${this.currentTrace.connectionName}`,
          })
        }
      }

      // Draw cursor position
      if (this.cursorPosition) {
        visualization.circles.push({
          center: { x: this.cursorPosition.x, y: this.cursorPosition.y },
          radius: this.currentTargetWidth / 2,
          stroke: this.hasInsufficientClearance ? "red" : "green",
          fill: "none",
          label: `Testing width: ${this.currentTargetWidth.toFixed(2)}mm (clearance: ${this.lastClearance.toFixed(2)}mm)`,
        })

        visualization.points.push({
          x: this.cursorPosition.x,
          y: this.cursorPosition.y,
          color: "orange",
          label: "Cursor",
        })
      }
    }

    // Draw unprocessed routes (faded, with colliding ones highlighted)
    for (const route of this.unprocessedRoutes) {
      if (route.route.length === 0) continue

      const isColliding = collidingRouteNames.has(route.connectionName)

      for (let i = 0; i < route.route.length - 1; i++) {
        const current = route.route[i]!
        const next = route.route[i + 1]!

        if (current.z === next.z) {
          visualization.lines.push({
            points: [
              { x: current.x, y: current.y },
              { x: next.x, y: next.y },
            ],
            strokeColor: isColliding
              ? "rgba(255, 0, 0, 0.8)"
              : "rgba(128, 128, 128, 0.3)",
            strokeWidth: route.traceThickness ?? this.minTraceWidth,
            label: isColliding
              ? `COLLIDING: ${route.connectionName}`
              : route.connectionName,
          })
        }
      }
    }

    return visualization
  }

  /** Returns the routes with determined widths. This is the primary output of the solver. */
  getHdRoutesWithWidths(): HighDensityRoute[] {
    return this.hdRoutesWithWidths
  }
}
