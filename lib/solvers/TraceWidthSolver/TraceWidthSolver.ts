// ============================================================
// FILE: lib/solvers/TraceWidthSolver/TraceWidthSolver.ts
// CHANGE: Full rewrite that supports traceWidthMultiplier, fixes the
//         broken constructor interface, and improves the width schedule.
// ============================================================

import { BaseSolver } from "../BaseSolver"
import { HighDensityRoute } from "lib/types/high-density-types"
import { Obstacle, SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { GraphicsObject } from "graphics-debug"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"

// ── Clearance cache key precision (mm rounded to 2 dp)
const CACHE_PRECISION = 2

// ── Metrics snapshot
export interface TraceWidthMetrics {
  totalTraces: number
  tracesAtFullWidth: number
  tracesNarrowed: number
  tracesAtMinWidth: number
  averageFinalWidth: number
  cacheHits: number
  cacheMisses: number
}

const MIN_CURSOR_STEP = 0.05
const MAX_CURSOR_STEP = 0.3
const CURSOR_STEPS_PER_TRACE = 200

// Allowed multiplier values — mirrors the type definition in srj-types.ts
const MIN_MULTIPLIER = 0.5
const MAX_MULTIPLIER = 16

interface Point2D {
  x: number
  y: number
}

interface Point3D extends Point2D {
  z: number
}

export interface TraceWidthSolverInput {
  hdRoutes: HighDensityRoute[]
  /** All connections from the SimpleRouteJson (after NetToPointPairs expansion). */
  connections: SimpleRouteConnection[]
  obstacles?: Obstacle[]
  connMap?: ConnectivityMap
  colorMap?: Record<string, string>
  minTraceWidth: number
  /**
   * Board-level nominal trace width. Used as the starting point for the
   * width schedule when a connection only specifies a traceWidthMultiplier
   * and no explicit nominalTraceWidth.
   */
  nominalTraceWidth?: number
  obstacleMargin?: number
  /**
   * Per-connection clearance override (mm). Overrides the global obstacleMargin
   * for the named connection. Useful for high-current traces that need more space.
   * Example: { VCC: 0.3, GND: 0.3 }
   */
  clearanceOverride?: Record<string, number>
  /**
   * Per-connection, per-layer trace width (mm). Takes priority over all other
   * width settings for the matching connection+layer combination.
   * Example: { VCC: { top: 0.4, bottom: 0.6 } }
   */
  traceWidthByLayer?: Record<string, Record<string, number>>
  layerCount: number
}

/**
 * TraceWidthSolver determines the optimal trace width for each route.
 *
 * For routes that carry a width request (via nominalTraceWidth or
 * traceWidthMultiplier on their connection), the solver walks along the
 * route with a cursor and checks clearance at each step.  It tries
 * progressively narrower widths from the TRACE_WIDTH_SCHEDULE:
 *
 *   [requestedWidth, midpoint, minTraceWidth]
 *
 * If none fit, minTraceWidth is used as the fallback.
 *
 * Routes without any width request are passed through unchanged —
 * they keep whatever traceThickness was set by the HighDensitySolver.
 *
 * ### Width resolution order (highest priority first)
 * 1. connection.nominalTraceWidth  — exact absolute width
 * 2. connection.traceWidthMultiplier × minTraceWidth  — relative multiplier
 * 3. srj.nominalTraceWidth  — board-level default
 * 4. Pass through unchanged
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
  /**
   * Maps connectionName → resolved target width (before clearance check).
   * Built once in the constructor so _step() is O(1) per route.
   */
  connectionTargetWidthMap: Map<string, number>

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
  /** Saved cursor position when a width fails — used to avoid re-scanning from start */
  failureSegmentIndex = 0
  failureSegmentT = 0
  adaptiveCursorStep = 0.1
  clearanceOverrideMap: Record<string, number> = {}
  traceWidthByLayer: Record<string, Record<string, number>> = {}

  // For visualization — track colliding objects
  // ── Clearance result cache: "x,y,z,width" → clearance
  private clearanceCache = new Map<string, number>()
  cacheHits = 0
  cacheMisses = 0

  // ── Metrics
  private metricsTracesAtFullWidth = 0
  private metricsTracesNarrowed = 0
  private metricsTracesAtMinWidth = 0
  private metricsFinalWidthSum = 0
  private metricsTotalTraces = 0

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
    this.nominalTraceWidth = input.nominalTraceWidth ?? input.minTraceWidth

    this.unprocessedRoutes = [...this.hdRoutes]
    this.connMap = input.connMap
    this.colorMap = input.colorMap
    this.TRACE_WIDTH_SCHEDULE = []
    this.clearanceOverrideMap = input.clearanceOverride ?? {}
    this.traceWidthByLayer = input.traceWidthByLayer ?? {}

    const inferredLayerCount = input.layerCount
    this.obstacles = createObjectsWithZLayers(
      input.obstacles ?? [],
      inferredLayerCount,
    )

    // Build the per-connection target width map.
    // Resolution order: nominalTraceWidth > multiplier × min > board nominal > undefined
    this.connectionTargetWidthMap = new Map()

    for (const connection of input.connections) {
      const resolved = this._resolveConnectionTargetWidth(connection)
      if (resolved !== undefined) {
        this.connectionTargetWidthMap.set(connection.name, resolved)
        // Also map merged connection names so stitched sub-routes are found
        if (connection.mergedConnectionNames) {
          for (const merged of connection.mergedConnectionNames) {
            // Don't overwrite a more specific mapping from an earlier iteration
            if (!this.connectionTargetWidthMap.has(merged)) {
              this.connectionTargetWidthMap.set(merged, resolved)
            }
          }
        }
      }
    }

    if (this.obstacles.length > 0) {
      this.obstacleSHI = new ObstacleSpatialHashIndex(
        "flatbush",
        this.obstacles,
      )
    }

    this.hdRouteSHI = new HighDensityRouteSpatialIndex(this.hdRoutes)
  }

  /**
   * Returns the target width for a connection, or undefined if none requested.
   */
  private _resolveConnectionTargetWidth(
    connection: SimpleRouteConnection,
    layer?: string,
  ): number | undefined {
    // 0. Per-connection per-layer width (highest priority)
    if (
      layer &&
      this.traceWidthByLayer[connection.name]?.[layer] !== undefined
    ) {
      return this.traceWidthByLayer[connection.name]![layer]!
    }

    // 1. Explicit absolute width wins
    if (connection.nominalTraceWidth !== undefined) {
      return connection.nominalTraceWidth
    }

    // 2. Multiplier × minTraceWidth
    if (connection.traceWidthMultiplier !== undefined) {
      const multiplier = this._clampMultiplier(connection.traceWidthMultiplier)
      return this.minTraceWidth * multiplier
    }

    // 3. Board-level nominal (only if different from min — no-op otherwise)
    if (
      this.nominalTraceWidth !== undefined &&
      this.nominalTraceWidth > this.minTraceWidth
    ) {
      return this.nominalTraceWidth
    }

    return undefined
  }

  /**
   * Returns the effective obstacle margin for a given connection name.
   * Falls back to the global obstacleMargin if no override is set.
   */
  private _getObstacleMargin(connectionName: string): number {
    return this.clearanceOverrideMap[connectionName] ?? this.obstacleMargin
  }

  /**
   * Clamps a user-supplied multiplier to the nearest valid value.
   * This prevents e.g. multiplier=3 from producing an unexpected width.
   */
  private _clampMultiplier(raw: number): number {
    return Math.min(Math.max(raw, MIN_MULTIPLIER), MAX_MULTIPLIER)
  }

  private _getTargetWidthForRoute(route: HighDensityRoute): number | undefined {
    const byConnectionName = this.connectionTargetWidthMap.get(
      route.connectionName,
    )
    if (byConnectionName !== undefined) return byConnectionName

    // Fall back to rootConnectionName for stitched sub-routes
    if (route.rootConnectionName) {
      return this.connectionTargetWidthMap.get(route.rootConnectionName)
    }
    return undefined
  }

  _step() {
    // If no current trace, dequeue the next one
    if (!this.currentTrace) {
      const nextTrace = this.unprocessedRoutes.shift()

      if (!nextTrace) {
        this.hdRoutesWithWidths = this.processedRoutes
        this.solved = true
        return
      }

      const targetWidth = this._getTargetWidthForRoute(nextTrace)

      // No width request — pass through unchanged
      if (targetWidth === undefined) {
        this.processedRoutes.push({ ...nextTrace })
        this.currentTrace = null
        return
      }

      this.currentTrace = nextTrace

      // Build a graduated schedule so the router prefers the full requested
      // width but gracefully narrows if it can't fit:
      //   [full, 3/4, 1/2, minTraceWidth]
      const mid1 = targetWidth - (targetWidth - this.minTraceWidth) * (1 / 3)
      const mid2 = targetWidth - (targetWidth - this.minTraceWidth) * (2 / 3)
      // Deduplicate and keep only values > minTraceWidth
      const schedule = [targetWidth, mid1, mid2].filter(
        (w, i, arr) => w > this.minTraceWidth + 0.001 && arr.indexOf(w) === i, // unique
      )
      schedule.push(this.minTraceWidth)
      this.TRACE_WIDTH_SCHEDULE = schedule

      if (this.currentTrace.route.length < 2) {
        // Too short to walk — assign the full requested width directly
        this.processedRoutes.push({
          ...this.currentTrace,
          traceThickness: targetWidth,
        })
        this.currentTrace = null
        return
      }

      this.currentScheduleIndex = 0
      this.currentTargetWidth = this.TRACE_WIDTH_SCHEDULE[0]!
      this.initializeCursor()
      return
    }

    // Step the cursor forward along the current trace
    const stepped = this.stepCursorForward()

    if (!stepped) {
      // Reached the end of the trace without a clearance failure → width fits!
      this.finalizeCurrentTrace(this.currentTargetWidth)
      return
    }

    const clearance = this.getClearanceAtPosition(this.cursorPosition!)
    const requiredClearance = this.currentTargetWidth / 2 + this.obstacleMargin

    if (clearance < requiredClearance) {
      // Current width doesn't fit — try next narrower value
      this.hasInsufficientClearance = true
      this.currentScheduleIndex++

      if (this.currentScheduleIndex < this.TRACE_WIDTH_SCHEDULE.length) {
        this.currentTargetWidth =
          this.TRACE_WIDTH_SCHEDULE[this.currentScheduleIndex]!
        this.initializeCursor()
      } else {
        // All schedule entries exhausted — fall back to minTraceWidth
        this.finalizeCurrentTrace(this.minTraceWidth)
      }
    }
  }

  private initializeCursor(resumeFromFailure = false) {
    if (!this.currentTrace) return

    // Compute adaptive step size based on trace length
    let totalLength = 0
    const route = this.currentTrace.route
    for (let i = 0; i < route.length - 1; i++) {
      const dx = route[i + 1]!.x - route[i]!.x
      const dy = route[i + 1]!.y - route[i]!.y
      totalLength += Math.sqrt(dx * dx + dy * dy)
    }
    this.adaptiveCursorStep = Math.min(
      MAX_CURSOR_STEP,
      Math.max(MIN_CURSOR_STEP, totalLength / CURSOR_STEPS_PER_TRACE),
    )

    if (resumeFromFailure && this.failureSegmentIndex > 0) {
      // Resume from the point where the previous width failed
      this.currentTraceSegmentIndex = this.failureSegmentIndex
      this.currentTraceSegmentT = this.failureSegmentT
      const seg = route[this.failureSegmentIndex]!
      const segNext = route[this.failureSegmentIndex + 1] ?? seg
      this.cursorPosition = {
        x: seg.x + (segNext.x - seg.x) * this.failureSegmentT,
        y: seg.y + (segNext.y - seg.y) * this.failureSegmentT,
        z: seg.z,
      }
    } else {
      const startPoint = route[0]!
      this.cursorPosition = { ...startPoint }
      this.currentTraceSegmentIndex = 0
      this.currentTraceSegmentT = 0
    }
    this.hasInsufficientClearance = false
  }

  private stepCursorForward(): boolean {
    if (!this.currentTrace || !this.cursorPosition) return false

    const route = this.currentTrace.route
    let remainingDistance = this.adaptiveCursorStep

    while (remainingDistance > 0) {
      if (this.currentTraceSegmentIndex >= route.length - 1) {
        return false
      }

      const segStart = route[this.currentTraceSegmentIndex]!
      const segEnd = route[this.currentTraceSegmentIndex + 1]!

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

  private isObstacleOwnJumperPad(obstacle: Obstacle): boolean {
    if (!this.currentTrace?.jumpers) return false
    const TOLERANCE = 0.01

    for (const jumper of this.currentTrace.jumpers) {
      const distToStart = Math.sqrt(
        (obstacle.center.x - jumper.start.x) ** 2 +
          (obstacle.center.y - jumper.start.y) ** 2,
      )
      const distToEnd = Math.sqrt(
        (obstacle.center.x - jumper.end.x) ** 2 +
          (obstacle.center.y - jumper.end.y) ** 2,
      )
      const maxDist = Math.max(obstacle.width, obstacle.height) / 2 + TOLERANCE
      if (distToStart < maxDist || distToEnd < maxDist) {
        return true
      }
    }
    return false
  }

  private getClearanceAtPosition(position: Point3D): number {
    if (!this.currentTrace) return Infinity

    // Check cache first
    const cacheKey = `${position.x.toFixed(CACHE_PRECISION)},${position.y.toFixed(CACHE_PRECISION)},${position.z},${this.currentTargetWidth.toFixed(CACHE_PRECISION)}`
    const cached = this.clearanceCache.get(cacheKey)
    if (cached !== undefined) {
      this.cacheHits++
      return cached
    }
    this.cacheMisses++

    const rootConnectionName =
      this.currentTrace.rootConnectionName ?? this.currentTrace.connectionName
    const searchRadius = this.currentTargetWidth * 3
    let minClearance = Infinity

    this.lastCollidingObstacles = []
    this.lastCollidingRoutes = []

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
        if (obstacle.connectedTo.includes(rootConnectionName)) continue

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
        if (this.isObstacleOwnJumperPad(obstacle)) continue

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

        const effectiveObstacleMargin = this._getObstacleMargin(
          this.currentTrace?.connectionName ?? "",
        )
        const requiredObstacleClearance =
          this.currentTargetWidth / 2 + effectiveObstacleMargin
        if (distToObstacle < requiredObstacleClearance) {
          this.lastCollidingObstacles.push(obstacle)
        }

        if (distToObstacle < minClearance) {
          minClearance = distToObstacle
        }
      }
    }

    const nearbyRoutes = this.hdRouteSHI.getConflictingRoutesNearPoint(
      { x: position.x, y: position.y, z: position.z },
      searchRadius,
    )

    for (const { conflictingRoute, distance } of nearbyRoutes) {
      const routeRootName =
        conflictingRoute.rootConnectionName ?? conflictingRoute.connectionName

      if (routeRootName === rootConnectionName) continue
      if (this.connMap?.areIdsConnected(rootConnectionName, routeRootName)) {
        continue
      }

      const otherTraceHalfWidth =
        (conflictingRoute.traceThickness ?? this.minTraceWidth) / 2
      const clearance = distance - otherTraceHalfWidth

      const effectiveTraceMargin = this._getObstacleMargin(
        this.currentTrace?.connectionName ?? "",
      )
      const requiredTraceClearance =
        this.currentTargetWidth / 2 + effectiveTraceMargin
      if (clearance < requiredTraceClearance) {
        this.lastCollidingRoutes.push(conflictingRoute)
      }

      if (clearance < minClearance) {
        minClearance = clearance
      }
    }

    this.lastClearance = minClearance
    this.clearanceCache.set(cacheKey, minClearance)
    return minClearance
  }

  private finalizeCurrentTrace(traceWidth: number) {
    if (!this.currentTrace) return

    // Update metrics
    this.metricsTotalTraces++
    this.metricsFinalWidthSum += traceWidth
    const targetWidth = this._getTargetWidthForRoute(this.currentTrace)
    if (targetWidth !== undefined) {
      if (Math.abs(traceWidth - targetWidth) < 0.001) {
        this.metricsTracesAtFullWidth++
      } else if (Math.abs(traceWidth - this.minTraceWidth) < 0.001) {
        this.metricsTracesAtMinWidth++
      } else {
        this.metricsTracesNarrowed++
      }
    }

    const routeWithWidth: HighDensityRoute = {
      connectionName: this.currentTrace.connectionName,
      rootConnectionName: this.currentTrace.rootConnectionName,
      traceThickness: traceWidth,
      viaDiameter: this.currentTrace.viaDiameter,
      route: [...this.currentTrace.route],
      vias: [...this.currentTrace.vias],
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
      title: `TraceWidthSolver (schedule: [${scheduleStr}]mm, min: ${this.minTraceWidth.toFixed(2)}mm, margin: ${this.obstacleMargin.toFixed(2)}mm)`,
    }

    const collidingObstacleIds = new Set(
      this.lastCollidingObstacles.map((o) => o.obstacleId),
    )
    const collidingRouteNames = new Set(
      this.lastCollidingRoutes.map((r) => r.connectionName),
    )

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

    for (const route of this.processedRoutes) {
      if (route.route.length === 0) continue

      // Color by thickness: green = requested width, yellow = reduced, orange = fallback
      const targetWidth = this._getTargetWidthForRoute(route)
      const isFullWidth =
        targetWidth !== undefined &&
        Math.abs((route.traceThickness ?? 0) - targetWidth) < 0.001
      const isMinWidth =
        Math.abs((route.traceThickness ?? 0) - this.minTraceWidth) < 0.001
      const strokeColor = isFullWidth
        ? "green"
        : isMinWidth
          ? "orange"
          : "yellow"

      for (let i = 0; i < route.route.length - 1; i++) {
        const current = route.route[i]!
        const next = route.route[i + 1]!

        if (current.insideJumperPad && next.insideJumperPad) continue

        if (current.z === next.z) {
          visualization.lines.push({
            points: [
              { x: current.x, y: current.y },
              { x: next.x, y: next.y },
            ],
            strokeColor,
            strokeWidth: route.traceThickness,
            label: `${route.connectionName} (w=${(route.traceThickness ?? 0).toFixed(2)})`,
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

      if (route.jumpers && route.jumpers.length > 0) {
        const jumperGraphics = getJumpersGraphics(route.jumpers, {
          color: strokeColor,
          label: route.connectionName,
        })
        visualization.rects.push(...(jumperGraphics.rects ?? []))
        visualization.lines.push(...(jumperGraphics.lines ?? []))
      }
    }

    if (this.currentTrace) {
      for (let i = 0; i < this.currentTrace.route.length - 1; i++) {
        const current = this.currentTrace.route[i]!
        const next = this.currentTrace.route[i + 1]!

        if (current.insideJumperPad && next.insideJumperPad) continue

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

  /**
   * Returns a metrics snapshot after solving is complete.
   */
  getMetrics(): TraceWidthMetrics {
    return {
      totalTraces: this.metricsTotalTraces,
      tracesAtFullWidth: this.metricsTracesAtFullWidth,
      tracesNarrowed: this.metricsTracesNarrowed,
      tracesAtMinWidth: this.metricsTracesAtMinWidth,
      averageFinalWidth:
        this.metricsTotalTraces > 0
          ? this.metricsFinalWidthSum / this.metricsTotalTraces
          : 0,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
    }
  }

  getHdRoutesWithWidths(): HighDensityRoute[] {
    return this.hdRoutesWithWidths
  }
}
