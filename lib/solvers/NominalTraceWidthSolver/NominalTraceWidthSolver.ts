import { BaseSolver } from "../BaseSolver"
import { HighDensityRoute } from "lib/types/high-density-types"
import { Obstacle, SimpleRouteConnection } from "lib/types"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { GraphicsObject } from "graphics-debug"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"

const CURSOR_STEP_DISTANCE = 0.5
const WIDTH_EPSILON = 1e-6

interface Point2D {
  x: number
  y: number
}

interface Point3D extends Point2D {
  z: number
}

export interface NominalTraceWidthSolverInput {
  hdRoutes: HighDensityRoute[]
  connection: SimpleRouteConnection[]
  obstacles?: Obstacle[]
  connMap?: ConnectivityMap
  colorMap?: Record<string, string>
  minTraceWidth: number
  obstacleMargin?: number
  layerCount: number
}

/**
 * NominalTraceWidthSolver tries to inflate routes to a connection's
 * nominalTraceWidth only when TraceWidthSolver left them at minTraceWidth.
 */
export class NominalTraceWidthSolver extends BaseSolver {
  override getSolverName(): string {
    return "nominalTraceWidthSolver"
  }

  hdRoutes: HighDensityRoute[]
  hdRoutesWithWidths: HighDensityRoute[] = []

  nominalTraceWidth: number
  minTraceWidth: number
  obstacleMargin: number
  connectionNominalTraceWidthMap: Map<string, number>

  unprocessedRoutes: HighDensityRoute[] = []
  processedRoutes: HighDensityRoute[] = []
  attemptedConnectionNames = new Set<string>()

  // Current trace being processed
  currentTrace: HighDensityRoute | null = null
  currentOriginalTrace: HighDensityRoute | null = null
  currentOriginalRoute: HighDensityRoute["route"] | null = null
  cursorPosition: Point3D | null = null
  currentTraceSegmentIndex = 0
  currentTraceSegmentT = 0
  currentTargetWidth: number = 0
  hasInsufficientClearance = false
  repositionAttempts = 0
  MAX_REPOSITION_ATTEMPTS = 100
  REPOSITION_STEP = 0.8

  // For visualization - track colliding objects
  lastCollidingObstacles: Obstacle[] = []
  lastCollidingRoutes: HighDensityRoute[] = []
  lastClearance: number = Infinity

  obstacles: Obstacle[] = []
  obstacleSHI?: ObstacleSpatialHashIndex
  hdRouteSHI: HighDensityRouteSpatialIndex
  connMap?: ConnectivityMap
  colorMap?: Record<string, string>

  constructor(input: NominalTraceWidthSolverInput) {
    super()
    this.MAX_ITERATIONS = 1e6

    this.hdRoutes = input.hdRoutes
    this.minTraceWidth = input.minTraceWidth
    this.obstacleMargin = input.obstacleMargin ?? 0.15
    this.nominalTraceWidth = 0

    this.connMap = input.connMap
    this.colorMap = input.colorMap
    const inferredLayerCount = input.layerCount
    this.obstacles = createObjectsWithZLayers(
      input.obstacles ?? [],
      inferredLayerCount,
    )
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

    // Partition routes: only those whose connection has nominalTraceWidth set
    // AND that TraceWidthSolver couldn't widen above minTraceWidth are
    // candidates. Everything else passes through unchanged so we don't redo
    // work TraceWidthSolver already did.
    for (const route of this.hdRoutes) {
      if (this.isEligibleForRepositioning(route)) {
        this.unprocessedRoutes.push(route)
      } else {
        this.processedRoutes.push(route)
      }
    }
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

  private isEligibleForRepositioning(route: HighDensityRoute): boolean {
    const nominalTraceWidth = this.getNominalTraceWidthForRoute(route)
    if (nominalTraceWidth === undefined) return false
    if (nominalTraceWidth <= this.minTraceWidth + WIDTH_EPSILON) return false
    if (route.route.length < 2) return false

    const currentTraceWidth = route.traceThickness ?? this.minTraceWidth
    return currentTraceWidth <= this.minTraceWidth + WIDTH_EPSILON
  }

  _step() {
    // If no current trace, dequeue and initialize one
    if (!this.currentTrace) {
      const nextTrace = this.unprocessedRoutes.shift()

      if (!nextTrace) {
        this.hdRoutesWithWidths = this.processedRoutes
        this.solved = true
        return
      }

      const nominalTraceWidth = this.getNominalTraceWidthForRoute(nextTrace)!

      // Work on a mutable copy so we can reposition segments without
      // touching the original route (used as fallback).
      this.currentOriginalTrace = { ...nextTrace }
      this.currentOriginalRoute = nextTrace.route.map((p) => ({ ...p }))
      const workingRoute = nextTrace.route.map((p) => ({ ...p }))
      this.currentTrace = { ...nextTrace, route: workingRoute }
      this.nominalTraceWidth = nominalTraceWidth
      this.currentTargetWidth = nominalTraceWidth
      this.attemptedConnectionNames.add(nextTrace.connectionName)
      this.repositionAttempts = 0
      this.initializeCursor()
      return
    }

    // Advance cursor one step along the (possibly repositioned) trace
    const stepped = this.stepCursorForward()

    if (!stepped) {
      // Reached end without collision - inflated trace works
      this.finalizeInflatedTrace(
        this.currentTargetWidth,
        this.currentTrace.route,
      )
      return
    }

    const clearance = this.getClearanceAtPosition(this.cursorPosition!)
    const requiredClearance = this.currentTargetWidth / 2 + this.obstacleMargin

    if (clearance < requiredClearance) {
      // Collision: shift the offending segment one REPOSITION_STEP away from
      // the colliders and restart the cursor.
      this.hasInsufficientClearance = true
      this.repositionAttempts++

      if (this.repositionAttempts > this.MAX_REPOSITION_ATTEMPTS) {
        this.finalizeUnchangedTrace()
        return
      }

      const escapeDir = this.getEscapeDirection(this.cursorPosition!)
      const segIdx = this.currentTraceSegmentIndex
      const route = this.currentTrace.route

      if (!escapeDir || segIdx < 0 || segIdx >= route.length - 1) {
        this.finalizeUnchangedTrace()
        return
      }

      const a = route[segIdx]!
      const b = route[segIdx + 1]!
      route[segIdx] = {
        ...a,
        x: a.x + escapeDir.x * this.REPOSITION_STEP,
        y: a.y + escapeDir.y * this.REPOSITION_STEP,
      }
      route[segIdx + 1] = {
        ...b,
        x: b.x + escapeDir.x * this.REPOSITION_STEP,
        y: b.y + escapeDir.y * this.REPOSITION_STEP,
      }

      this.initializeCursor()
    }
  }

  /**
   * Pushes the current trace into processedRoutes with the given width and
   * route, then clears all per-trace state so the next _step dequeues a new
   * trace.
   */
  private finalizeInflatedTrace(
    traceWidth: number,
    route: HighDensityRoute["route"],
  ) {
    if (!this.currentTrace) return

    this.processedRoutes.push({
      connectionName: this.currentTrace.connectionName,
      rootConnectionName: this.currentTrace.rootConnectionName,
      traceThickness: traceWidth,
      viaDiameter: this.currentTrace.viaDiameter,
      route: route.map((p) => ({ ...p })),
      vias: [...this.currentTrace.vias],
      jumpers: this.currentTrace.jumpers,
    })

    this.currentTrace = null
    this.currentOriginalTrace = null
    this.currentOriginalRoute = null
    this.cursorPosition = null
    this.hasInsufficientClearance = false
    this.repositionAttempts = 0
  }

  private finalizeUnchangedTrace() {
    if (!this.currentOriginalTrace) return

    this.processedRoutes.push({
      ...this.currentOriginalTrace,
      route:
        this.currentOriginalRoute?.map((p) => ({ ...p })) ??
        this.currentOriginalTrace.route.map((p) => ({ ...p })),
      vias: [...this.currentOriginalTrace.vias],
    })

    this.currentTrace = null
    this.currentOriginalTrace = null
    this.currentOriginalRoute = null
    this.cursorPosition = null
    this.hasInsufficientClearance = false
    this.repositionAttempts = 0
  }

  /**
   * Computes a unit vector pointing away from the colliding obstacles/routes
   * tracked by the most recent getClearanceAtPosition call.
   */
  private getEscapeDirection(position: Point3D): Point2D | null {
    let dx = 0
    let dy = 0

    for (const obstacle of this.lastCollidingObstacles) {
      const ox = position.x - obstacle.center.x
      const oy = position.y - obstacle.center.y
      const m = Math.hypot(ox, oy)
      if (m > 0) {
        dx += ox / m
        dy += oy / m
      }
    }

    for (const route of this.lastCollidingRoutes) {
      let minDist = Infinity
      let closestX = 0
      let closestY = 0
      for (let i = 0; i < route.route.length - 1; i++) {
        const a = route.route[i]!
        const b = route.route[i + 1]!
        const ax = b.x - a.x
        const ay = b.y - a.y
        const segLen2 = ax * ax + ay * ay
        if (segLen2 === 0) continue
        let t = ((position.x - a.x) * ax + (position.y - a.y) * ay) / segLen2
        t = Math.max(0, Math.min(1, t))
        const px = a.x + t * ax
        const py = a.y + t * ay
        const d = Math.hypot(position.x - px, position.y - py)
        if (d < minDist) {
          minDist = d
          closestX = px
          closestY = py
        }
      }
      const ox = position.x - closestX
      const oy = position.y - closestY
      const m = Math.hypot(ox, oy)
      if (m > 0) {
        dx += ox / m
        dy += oy / m
      }
    }

    const mag = Math.hypot(dx, dy)
    if (mag === 0) return null
    return { x: dx / mag, y: dy / mag }
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

    // Track only the single closest colliding obstacle for visualization
    let closestCollidingObstacle: Obstacle | null = null
    let closestCollidingObstacleDist = Infinity

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

        // Track only the single closest obstacle that violates clearance
        const requiredObstacleClearance =
          this.currentTargetWidth / 2 + this.obstacleMargin
        if (
          distToObstacle < requiredObstacleClearance &&
          distToObstacle < closestCollidingObstacleDist
        ) {
          closestCollidingObstacleDist = distToObstacle
          closestCollidingObstacle = obstacle
        }

        if (distToObstacle < minClearance) {
          minClearance = distToObstacle
        }
      }

      if (closestCollidingObstacle) {
        this.lastCollidingObstacles.push(closestCollidingObstacle)
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

  visualize(): GraphicsObject {
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
      title: `Nominal Trace Width Solver (only min-width routes, fallback unchanged, margin: ${this.obstacleMargin.toFixed(2)}mm)`,
    }

    if (!this.currentTrace && this.attemptedConnectionNames.size === 0) {
      return visualization
    }

    // Build set of colliding obstacles for quick lookup (compare by ref so
    // obstacles with undefined obstacleId don't all match each other)
    const collidingObstacleSet = new Set<Obstacle>(this.lastCollidingObstacles)
    const collidingRouteNames = new Set(
      this.lastCollidingRoutes.map((r) => r.connectionName),
    )

    // Draw all obstacles (faded, with colliding ones highlighted)
    for (const obstacle of this.obstacles) {
      const isColliding = collidingObstacleSet.has(obstacle)
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
      if (!this.attemptedConnectionNames.has(route.connectionName)) continue

      const isNominalWidth = route.traceThickness === this.nominalTraceWidth
      const strokeColor = isNominalWidth ? "green" : "orange"

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
      // Faded original route so any segment repositioning is visible
      if (this.currentOriginalRoute) {
        for (let i = 0; i < this.currentOriginalRoute.length - 1; i++) {
          const current = this.currentOriginalRoute[i]!
          const next = this.currentOriginalRoute[i + 1]!

          if (current.insideJumperPad && next.insideJumperPad) continue

          if (current.z === next.z) {
            visualization.lines.push({
              points: [
                { x: current.x, y: current.y },
                { x: next.x, y: next.y },
              ],
              strokeColor: "rgba(0, 255, 255, 0.25)",
              strokeWidth: this.currentTargetWidth,
              label: `Original: ${this.currentTrace.connectionName}`,
            })
          }
        }
      }

      const collisionSegIdx = this.hasInsufficientClearance
        ? this.currentTraceSegmentIndex
        : -1

      for (let i = 0; i < this.currentTrace.route.length - 1; i++) {
        const current = this.currentTrace.route[i]!
        const next = this.currentTrace.route[i + 1]!

        // Skip segments inside jumper pads
        if (current.insideJumperPad && next.insideJumperPad) {
          continue
        }

        if (current.z === next.z) {
          const isCollisionSeg = i === collisionSegIdx
          visualization.lines.push({
            points: [
              { x: current.x, y: current.y },
              { x: next.x, y: next.y },
            ],
            strokeColor: isCollisionSeg ? "magenta" : "cyan",
            strokeWidth: this.currentTargetWidth,
            label: isCollisionSeg
              ? `Repositioning seg ${i} (attempt ${this.repositionAttempts}/${this.MAX_REPOSITION_ATTEMPTS})`
              : `Processing: ${this.currentTrace.connectionName} (target w=${this.currentTargetWidth.toFixed(2)})`,
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
