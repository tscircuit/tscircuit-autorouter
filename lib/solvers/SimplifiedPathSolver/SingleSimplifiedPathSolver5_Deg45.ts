import {
  doSegmentsIntersect,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import { HighDensityIntraNodeRoute, Jumper } from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import { Obstacle } from "lib/types"
import { GraphicsObject } from "graphics-debug"
import { SingleSimplifiedPathSolver } from "./SingleSimplifiedPathSolver"
import { calculate45DegreePaths } from "lib/utils/calculate45DegreePaths"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { SegmentTree } from "lib/data-structures/SegmentTree"
import {
  segmentToBoxMinDistance,
  computeGapBetweenBoxes,
  segmentToBoundsMinDistance,
} from "@tscircuit/math-utils"
import { doesSegmentCrossPolygonBoundary } from "lib/utils/polygonContainment"
import { JUMPER_DIMENSIONS } from "lib/utils/jumperSizes"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

interface Point {
  x: number
  y: number
  z: number
}

interface PathSegment {
  start: Point
  end: Point
  length: number
  startDistance: number
  endDistance: number
}

export class SingleSimplifiedPathSolver5 extends SingleSimplifiedPathSolver {
  private pathSegments: PathSegment[] = []
  private totalPathLength: number = 0
  private headDistanceAlongPath: number = 0
  private tailDistanceAlongPath: number = 0
  private minStepSize: number = 0.25 // Default step size, can be adjusted
  private lastValidPath: Point[] | null = null // Store the current valid path
  private lastValidPathHeadDistance: number = 0

  /** Amount the step size is reduced when the step isn't possible */
  STEP_SIZE_REDUCTION_FACTOR = 0.25
  maxStepSize = 4
  currentStepSize = this.maxStepSize
  lastHeadMoveDistance = 0

  cachedValidPathSegments: Set<string>

  filteredObstacles: Obstacle[] = []
  filteredObstaclePathSegments: Array<[Point, Point]> = []
  filteredVias: Array<{ x: number; y: number; diameter: number }> = []
  filteredJumperPads: Array<{
    center: { x: number; y: number }
    width: number
    height: number
    connectionName: string
  }> = []

  /** Indices in inputRoute.route that correspond to jumper pad points (must be preserved) */
  jumperPadPointIndices: Set<number> = new Set()

  segmentTree!: SegmentTree

  OBSTACLE_MARGIN = 0.1
  TRACE_THICKNESS = 0.15

  TAIL_JUMP_RATIO: number = 0.8

  constructor(
    params: ConstructorParameters<typeof SingleSimplifiedPathSolver>[0],
  ) {
    super(params)

    this.cachedValidPathSegments = new Set()

    // Handle empty or single-point routes
    if (this.inputRoute.route.length <= 1) {
      this.newRoute = [...this.inputRoute.route]
      this.solved = true
      return
    }

    const bounds = this.inputRoute.route.reduce(
      (acc, point) => {
        acc.minX = Math.min(acc.minX, point.x)
        acc.maxX = Math.max(acc.maxX, point.x)
        acc.minY = Math.min(acc.minY, point.y)
        acc.maxY = Math.max(acc.maxY, point.y)
        return acc
      },
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
    )
    const boundsBox = {
      center: {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
      },
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
    }

    this.filteredObstacles = this.obstacles
      .filter(
        (obstacle) =>
          !obstacle.connectedTo.some((id) =>
            this.connMap.areIdsConnected(this.inputRoute.connectionName, id),
          ),
      )
      .filter((obstacle) => {
        if (
          obstacle.connectedTo.some((obsId) =>
            this.connMap.areIdsConnected(this.inputRoute.connectionName, obsId),
          )
        ) {
          return false
        }

        const distance = computeGapBetweenBoxes(boundsBox, obstacle)

        if (distance < this.OBSTACLE_MARGIN + this.TRACE_THICKNESS / 2) {
          return true
        }

        return false
      })

    this.filteredObstaclePathSegments = this.otherHdRoutes.flatMap(
      (hdRoute) => {
        if (
          this.connMap.areIdsConnected(
            this.inputRoute.connectionName,
            hdRoute.connectionName,
          )
        ) {
          return []
        }

        const route = hdRoute.route
        const segments: Array<[Point, Point]> = []
        for (let i = 0; i < route.length - 1; i++) {
          const start = route[i]
          const end = route[i + 1]

          const minX = Math.min(start.x, end.x)
          const maxX = Math.max(start.x, end.x)
          const minY = Math.min(start.y, end.y)
          const maxY = Math.max(start.y, end.y)

          if (
            minX <= bounds.maxX &&
            maxX >= bounds.minX &&
            minY <= bounds.maxY &&
            maxY >= bounds.minY
          ) {
            segments.push([start, end])
          }
        }

        return segments
      },
    )
    this.segmentTree = new SegmentTree(this.filteredObstaclePathSegments)

    this.filteredVias = this.otherHdRoutes.flatMap((hdRoute) => {
      if (
        this.connMap.areIdsConnected(
          this.inputRoute.connectionName,
          hdRoute.connectionName,
        )
      ) {
        return []
      }

      const vias = hdRoute.vias
      const filteredVias: Array<{ x: number; y: number; diameter: number }> = []
      for (const via of vias) {
        const margin =
          this.OBSTACLE_MARGIN +
          this.TRACE_THICKNESS / 2 +
          hdRoute.viaDiameter / 2
        const minX = via.x - margin
        const maxX = via.x + margin
        const minY = via.y - margin
        const maxY = via.y + margin

        if (
          minX <= bounds.maxX &&
          maxX >= bounds.minX &&
          minY <= bounds.maxY &&
          maxY >= bounds.minY
        ) {
          filteredVias.push({ ...via, diameter: hdRoute.viaDiameter })
        }
      }
      return filteredVias
    })

    // Helper function to extract jumper pads from a route
    const extractJumperPads = (
      jumpers: Jumper[],
      connectionName: string,
    ): Array<{
      center: { x: number; y: number }
      width: number
      height: number
      connectionName: string
    }> => {
      const pads: Array<{
        center: { x: number; y: number }
        width: number
        height: number
        connectionName: string
      }> = []

      for (const jumper of jumpers) {
        const dims =
          JUMPER_DIMENSIONS[jumper.footprint] ?? JUMPER_DIMENSIONS["0603"]

        // Determine jumper orientation to get correct pad dimensions
        const dx = jumper.end.x - jumper.start.x
        const dy = jumper.end.y - jumper.start.y
        const isHorizontal = Math.abs(dx) > Math.abs(dy)
        const padWidth = isHorizontal ? dims.padLength : dims.padWidth
        const padHeight = isHorizontal ? dims.padWidth : dims.padLength

        // Check if start pad is within bounds
        const startMargin = this.OBSTACLE_MARGIN + this.TRACE_THICKNESS / 2
        if (
          jumper.start.x - padWidth / 2 - startMargin <= bounds.maxX &&
          jumper.start.x + padWidth / 2 + startMargin >= bounds.minX &&
          jumper.start.y - padHeight / 2 - startMargin <= bounds.maxY &&
          jumper.start.y + padHeight / 2 + startMargin >= bounds.minY
        ) {
          pads.push({
            center: jumper.start,
            width: padWidth,
            height: padHeight,
            connectionName: connectionName,
          })
        }

        // Check if end pad is within bounds
        if (
          jumper.end.x - padWidth / 2 - startMargin <= bounds.maxX &&
          jumper.end.x + padWidth / 2 + startMargin >= bounds.minX &&
          jumper.end.y - padHeight / 2 - startMargin <= bounds.maxY &&
          jumper.end.y + padHeight / 2 + startMargin >= bounds.minY
        ) {
          pads.push({
            center: jumper.end,
            width: padWidth,
            height: padHeight,
            connectionName: connectionName,
          })
        }
      }

      return pads
    }

    // Collect jumper pads from other routes as obstacles
    this.filteredJumperPads = this.otherHdRoutes.flatMap((hdRoute) => {
      if (
        this.connMap.areIdsConnected(
          this.inputRoute.connectionName,
          hdRoute.connectionName,
        )
      ) {
        return []
      }

      return extractJumperPads(hdRoute.jumpers ?? [], hdRoute.connectionName)
    })

    // Also add our own route's jumper pads as obstacles
    // (we shouldn't simplify traces through our own jumper pads)
    if (this.inputRoute.jumpers && this.inputRoute.jumpers.length > 0) {
      this.filteredJumperPads.push(
        ...extractJumperPads(
          this.inputRoute.jumpers,
          this.inputRoute.connectionName,
        ),
      )

      // Identify which route points correspond to our jumper pads
      // These points MUST be preserved during simplification
      for (const jumper of this.inputRoute.jumpers) {
        for (let i = 0; i < this.inputRoute.route.length; i++) {
          const p = this.inputRoute.route[i]
          // Check if this point matches start or end of jumper
          if (
            (Math.abs(p.x - jumper.start.x) < 0.01 &&
              Math.abs(p.y - jumper.start.y) < 0.01) ||
            (Math.abs(p.x - jumper.end.x) < 0.01 &&
              Math.abs(p.y - jumper.end.y) < 0.01)
          ) {
            this.jumperPadPointIndices.add(i)
          }
        }
      }
    }

    // Compute path segments and total length
    this.preprocessRoutePoints()
    this.computePathSegments()
  }

  /**
   * Pre-process route points to nudge any that are too close to obstacle edges.
   * This prevents the simplification algorithm from receiving invalid waypoints
   * that cannot be reached without violating clearance constraints.
   */
  private preprocessRoutePoints() {
    const requiredClearance = this.OBSTACLE_MARGIN + this.TRACE_THICKNESS / 2
    // Use a larger zone for corner detection to catch diagonal approach paths
    const cornerDetectionRadius = requiredClearance * 2.5
    const route = this.inputRoute.route

    for (let i = 1; i < route.length - 1; i++) {
      // Skip first and last points (endpoints must be preserved exactly)
      // Also skip jumper pad points
      if (this.jumperPadPointIndices.has(i)) {
        continue
      }

      const point = route[i]
      const prevPoint = route[i - 1]
      let nudgeX = 0
      let nudgeY = 0

      for (const obstacle of this.filteredObstacles) {
        if (!this.isObstacleOnLayer(obstacle, point.z)) {
          continue
        }

        // Calculate obstacle bounds
        const left = obstacle.center.x - obstacle.width / 2
        const right = obstacle.center.x + obstacle.width / 2
        const top = obstacle.center.y + obstacle.height / 2
        const bottom = obstacle.center.y - obstacle.height / 2

        // Check if point is within the danger zone (inside or very close to edge)
        const isWithinX =
          point.x >= left - requiredClearance &&
          point.x <= right + requiredClearance
        const isWithinY =
          point.y >= bottom - requiredClearance &&
          point.y <= top + requiredClearance

        // Also check for corner proximity with larger radius
        const corners = [
          { x: right, y: top },
          { x: right, y: bottom },
          { x: left, y: top },
          { x: left, y: bottom },
        ]

        // Check if point is near any corner (even if outside the direct edge zones)
        for (const corner of corners) {
          const distToCorner = Math.sqrt(
            (point.x - corner.x) ** 2 + (point.y - corner.y) ** 2,
          )

          if (distToCorner < cornerDetectionRadius) {
            // Check if the approaching path would pass too close to this corner
            // by checking if the previous point is on the opposite side of the corner
            const approachFromRight = prevPoint.x > corner.x
            const approachFromAbove = prevPoint.y > corner.y
            const pointToRight = point.x >= corner.x
            const pointAbove = point.y >= corner.y

            // Determine if this is a diagonal approach that could graze the corner
            const isDiagonalApproach =
              approachFromRight !== pointToRight ||
              approachFromAbove !== pointAbove ||
              (prevPoint.x > corner.x &&
                point.x <= corner.x + requiredClearance &&
                point.y > corner.y) ||
              (prevPoint.x < corner.x &&
                point.x >= corner.x - requiredClearance &&
                point.y > corner.y) ||
              (prevPoint.y > corner.y &&
                point.y <= corner.y + requiredClearance &&
                point.x > corner.x) ||
              (prevPoint.y < corner.y &&
                point.y >= corner.y - requiredClearance &&
                point.x > corner.x)

            // If we're close to a corner and approaching diagonally, nudge away
            if (distToCorner < requiredClearance * 1.5 || isDiagonalApproach) {
              // Calculate nudge direction - away from corner
              const angle = Math.atan2(point.y - corner.y, point.x - corner.x)
              const targetDist = requiredClearance * 1.5

              if (distToCorner < targetDist) {
                const nudgeDist = targetDist - distToCorner + 0.01
                const candidateNudgeX = Math.cos(angle) * nudgeDist
                const candidateNudgeY = Math.sin(angle) * nudgeDist

                // Only apply if this is a larger nudge than previous
                if (Math.abs(candidateNudgeX) > Math.abs(nudgeX)) {
                  nudgeX = candidateNudgeX
                }
                if (Math.abs(candidateNudgeY) > Math.abs(nudgeY)) {
                  nudgeY = candidateNudgeY
                }
              }
            }
          }
        }

        if (!isWithinX || !isWithinY) {
          continue
        }

        // Calculate distances to each edge
        const distToRight = point.x - right
        const distToLeft = left - point.x
        const distToTop = point.y - top
        const distToBottom = bottom - point.y

        // Determine if we're in the horizontal or vertical zone
        const inHorizontalZone = point.y > bottom && point.y < top
        const inVerticalZone = point.x > left && point.x < right

        // Handle edge proximity
        if (inHorizontalZone) {
          // Point is in the horizontal zone (level with the obstacle)
          if (distToRight >= 0 && distToRight < requiredClearance) {
            // Too close to right edge - nudge right
            nudgeX = Math.max(nudgeX, requiredClearance - distToRight + 0.01)
          } else if (distToLeft >= 0 && distToLeft < requiredClearance) {
            // Too close to left edge - nudge left
            nudgeX = Math.min(nudgeX, -(requiredClearance - distToLeft + 0.01))
          }
        }

        if (inVerticalZone) {
          // Point is in the vertical zone (above/below the obstacle)
          if (distToTop >= 0 && distToTop < requiredClearance) {
            // Too close to top edge - nudge up
            nudgeY = Math.max(nudgeY, requiredClearance - distToTop + 0.01)
          } else if (distToBottom >= 0 && distToBottom < requiredClearance) {
            // Too close to bottom edge - nudge down
            nudgeY = Math.min(
              nudgeY,
              -(requiredClearance - distToBottom + 0.01),
            )
          }
        }

        // Handle corner cases - point is near a corner of the obstacle
        if (!inHorizontalZone && !inVerticalZone) {
          // We're in a corner region
          const cornerX = point.x < left ? left : right
          const cornerY = point.y < bottom ? bottom : top
          const cornerDist = Math.sqrt(
            (point.x - cornerX) ** 2 + (point.y - cornerY) ** 2,
          )

          if (cornerDist < requiredClearance) {
            // Nudge away from corner
            const angle = Math.atan2(point.y - cornerY, point.x - cornerX)
            const nudgeDist = requiredClearance - cornerDist + 0.01
            nudgeX += Math.cos(angle) * nudgeDist
            nudgeY += Math.sin(angle) * nudgeDist
          }
        }
      }

      // Apply the nudge if any
      if (nudgeX !== 0 || nudgeY !== 0) {
        route[i] = {
          x: point.x + nudgeX,
          y: point.y + nudgeY,
          z: point.z,
        }
      }
    }
  }

  // Compute the path segments and their distances
  private computePathSegments() {
    let cumulativeDistance = 0

    for (let i = 0; i < this.inputRoute.route.length - 1; i++) {
      const start = this.inputRoute.route[i]
      const end = this.inputRoute.route[i + 1]

      // Calculate segment length using Euclidean distance
      const length =
        Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2) + i / 10000

      this.pathSegments.push({
        start,
        end,
        length,
        startDistance: cumulativeDistance,
        endDistance: cumulativeDistance + length,
      })

      cumulativeDistance += length
    }

    this.totalPathLength = cumulativeDistance
  }

  // Helper to check if two points are the same
  private arePointsEqual(p1: Point, p2: Point): boolean {
    return p1.x === p2.x && p1.y === p2.y && p1.z === p2.z
  }

  // Get point at a specific distance along the path
  private getPointAtDistance(distance: number): Point {
    // Ensure distance is within bounds
    distance = Math.max(0, Math.min(distance, this.totalPathLength))

    // Find the segment that contains this distance
    const segment = this.pathSegments.find(
      (seg) => distance >= seg.startDistance && distance <= seg.endDistance,
    )

    if (!segment) {
      // Fallback to last point if segment not found
      return this.inputRoute.route[this.inputRoute.route.length - 1]
    }

    // Calculate interpolation factor (between 0 and 1)
    const factor = (distance - segment.startDistance) / segment.length

    // Interpolate the point
    return {
      x: segment.start.x + factor * (segment.end.x - segment.start.x),
      y: segment.start.y + factor * (segment.end.y - segment.start.y),
      z: factor < 0.5 ? segment.start.z : segment.end.z, // Z doesn't interpolate - use the segment's start z value
    }
  }

  // Find nearest index in the original route for a given distance
  private getNearestIndexForDistance(distance: number): number {
    if (distance <= 0) return 0
    if (distance >= this.totalPathLength)
      return this.inputRoute.route.length - 1

    // Find the segment that contains this distance
    const segmentIndex = this.pathSegments.findIndex(
      (seg) => distance >= seg.startDistance && distance <= seg.endDistance,
    )

    if (segmentIndex === -1) return 0

    // If closer to the end of the segment, return the next index
    const segment = this.pathSegments[segmentIndex]
    const midDistance = (segment.startDistance + segment.endDistance) / 2

    return distance > midDistance ? segmentIndex + 1 : segmentIndex
  }

  /**
   * Check if an obstacle is on the given z-layer.
   * Uses zLayers if available, otherwise falls back to checking layer names.
   */
  private isObstacleOnLayer(obstacle: Obstacle, z: number): boolean {
    if (obstacle.zLayers) {
      return obstacle.zLayers.includes(z)
    }
    // Fallback: check layer names for common cases
    // z=0 corresponds to "top", z=1 corresponds to "bottom" for 2-layer boards
    // For boards with more layers, inner layers would be "inner1", "inner2", etc.
    if (obstacle.layers) {
      if (z === 0 && obstacle.layers.includes("top")) {
        return true
      }
      // For bottom layer, we assume z=1 for 2-layer boards
      // This is a simplification; a more robust solution would pass layerCount
      if (z === 1 && obstacle.layers.includes("bottom")) {
        return true
      }
      // Check inner layers
      if (z > 0 && obstacle.layers.includes(`inner${z}`)) {
        return true
      }
    }
    return false
  }

  /**
   * Nudge a point away from nearby obstacles to maintain clearance.
   * Returns a new point that is at least OBSTACLE_MARGIN + TRACE_THICKNESS/2 away from all obstacles.
   * Also handles corner cases where the point is near obstacle corners.
   */
  private nudgePointFromObstacles(point: Point): Point {
    const requiredClearance = this.OBSTACLE_MARGIN + this.TRACE_THICKNESS / 2
    let nudgedPoint = { ...point }

    for (const obstacle of this.filteredObstacles) {
      if (!this.isObstacleOnLayer(obstacle, point.z)) {
        continue
      }

      // Calculate obstacle bounds
      const left = obstacle.center.x - obstacle.width / 2
      const right = obstacle.center.x + obstacle.width / 2
      const top = obstacle.center.y + obstacle.height / 2
      const bottom = obstacle.center.y - obstacle.height / 2

      // Check distance to each corner and edge
      const distToRight = nudgedPoint.x - right
      const distToLeft = left - nudgedPoint.x
      const distToTop = nudgedPoint.y - top
      const distToBottom = bottom - nudgedPoint.y

      // Handle right edge (point is to the right of obstacle)
      if (distToRight >= 0 && distToRight < requiredClearance) {
        // Point is close to right edge - check if it's near the obstacle vertically
        if (
          nudgedPoint.y >= bottom - requiredClearance &&
          nudgedPoint.y <= top + requiredClearance
        ) {
          nudgedPoint.x = right + requiredClearance
        }
      }

      // Handle left edge (point is to the left of obstacle)
      if (distToLeft >= 0 && distToLeft < requiredClearance) {
        if (
          nudgedPoint.y >= bottom - requiredClearance &&
          nudgedPoint.y <= top + requiredClearance
        ) {
          nudgedPoint.x = left - requiredClearance
        }
      }

      // Handle top edge (point is above obstacle)
      if (distToTop >= 0 && distToTop < requiredClearance) {
        if (
          nudgedPoint.x >= left - requiredClearance &&
          nudgedPoint.x <= right + requiredClearance
        ) {
          nudgedPoint.y = top + requiredClearance
        }
      }

      // Handle bottom edge (point is below obstacle)
      if (distToBottom >= 0 && distToBottom < requiredClearance) {
        if (
          nudgedPoint.x >= left - requiredClearance &&
          nudgedPoint.x <= right + requiredClearance
        ) {
          nudgedPoint.y = bottom - requiredClearance
        }
      }

      // Handle corners - if point is near a corner, nudge diagonally
      // Top-right corner
      if (
        distToRight >= 0 &&
        distToRight < requiredClearance &&
        distToTop >= 0 &&
        distToTop < requiredClearance
      ) {
        const cornerDist = Math.sqrt(distToRight ** 2 + distToTop ** 2)
        if (cornerDist < requiredClearance) {
          // Nudge diagonally away from corner
          const scale = requiredClearance / cornerDist
          nudgedPoint.x = right + distToRight * scale
          nudgedPoint.y = top + distToTop * scale
        }
      }

      // Top-left corner
      if (
        distToLeft >= 0 &&
        distToLeft < requiredClearance &&
        distToTop >= 0 &&
        distToTop < requiredClearance
      ) {
        const cornerDist = Math.sqrt(distToLeft ** 2 + distToTop ** 2)
        if (cornerDist < requiredClearance) {
          const scale = requiredClearance / cornerDist
          nudgedPoint.x = left - distToLeft * scale
          nudgedPoint.y = top + distToTop * scale
        }
      }

      // Bottom-right corner
      if (
        distToRight >= 0 &&
        distToRight < requiredClearance &&
        distToBottom >= 0 &&
        distToBottom < requiredClearance
      ) {
        const cornerDist = Math.sqrt(distToRight ** 2 + distToBottom ** 2)
        if (cornerDist < requiredClearance) {
          const scale = requiredClearance / cornerDist
          nudgedPoint.x = right + distToRight * scale
          nudgedPoint.y = bottom - distToBottom * scale
        }
      }

      // Bottom-left corner
      if (
        distToLeft >= 0 &&
        distToLeft < requiredClearance &&
        distToBottom >= 0 &&
        distToBottom < requiredClearance
      ) {
        const cornerDist = Math.sqrt(distToLeft ** 2 + distToBottom ** 2)
        if (cornerDist < requiredClearance) {
          const scale = requiredClearance / cornerDist
          nudgedPoint.x = left - distToLeft * scale
          nudgedPoint.y = bottom - distToBottom * scale
        }
      }
    }

    return nudgedPoint
  }

  // Check if a path segment is valid
  isValidPathSegment(start: Point, end: Point): boolean {
    // Check if the segment intersects with any obstacle
    for (const obstacle of this.filteredObstacles) {
      if (!this.isObstacleOnLayer(obstacle, start.z)) {
        continue
      }

      const distToObstacle = segmentToBoxMinDistance(start, end, obstacle)

      // Check if the line might intersect with this obstacle's borders
      if (distToObstacle < this.OBSTACLE_MARGIN + this.TRACE_THICKNESS / 2) {
        return false
      }
    }

    // Check if the segment intersects with any other route
    const segmentsThatCouldIntersect =
      this.segmentTree.getSegmentsThatCouldIntersect(start, end)
    for (const [otherSegA, otherSegB, segId] of segmentsThatCouldIntersect) {
      // Only check intersection if we're on the same layer
      if (otherSegA.z === start.z && otherSegB.z === start.z) {
        const distBetweenSegments = minimumDistanceBetweenSegments(
          { x: start.x, y: start.y },
          { x: end.x, y: end.y },
          { x: otherSegA.x, y: otherSegA.y },
          { x: otherSegB.x, y: otherSegB.y },
        )
        if (distBetweenSegments < this.OBSTACLE_MARGIN + this.TRACE_THICKNESS) {
          return false
        }
      }
    }

    for (const via of this.filteredVias) {
      if (
        pointToSegmentDistance(via, start, end) <
        this.OBSTACLE_MARGIN + via.diameter / 2 + this.TRACE_THICKNESS / 2
      ) {
        return false
      }
    }

    // Check if the segment intersects with any jumper pads
    for (const jumperPad of this.filteredJumperPads) {
      const distToJumperPad = segmentToBoxMinDistance(start, end, jumperPad)

      if (distToJumperPad < this.OBSTACLE_MARGIN + this.TRACE_THICKNESS / 2) {
        return false
      }
    }

    if (this.outline && this.outline.length >= 3) {
      const crossesOutline = doesSegmentCrossPolygonBoundary({
        start: { x: start.x, y: start.y },
        end: { x: end.x, y: end.y },
        polygon: this.outline,
      })

      if (crossesOutline) {
        return false
      }
    }

    return true
  }

  // Check if a path with multiple points is valid
  isValidPath(pointsInRoute: Point[]): boolean {
    if (pointsInRoute.length < 2) return true

    // Check for layer changes - we don't allow simplifying across layer changes
    for (let i = 0; i < pointsInRoute.length - 1; i++) {
      if (pointsInRoute[i].z !== pointsInRoute[i + 1].z) {
        return false
      }
    }

    // Check each segment of the path
    for (let i = 0; i < pointsInRoute.length - 1; i++) {
      if (!this.isValidPathSegment(pointsInRoute[i], pointsInRoute[i + 1])) {
        return false
      }
    }

    return true
  }

  // Find a valid 45-degree path between two points
  private find45DegreePath(start: Point, end: Point): Point[] | null {
    // Skip if points are the same
    if (this.arePointsEqual(start, end)) {
      return [start]
    }

    // Skip 45-degree check if we're on different layers
    if (start.z !== end.z) {
      return null
    }

    // Calculate potential 45-degree paths
    const possiblePaths = calculate45DegreePaths(
      { x: start.x, y: start.y },
      { x: end.x, y: end.y },
    )

    // Check each path for validity
    for (const path of possiblePaths) {
      // Convert the 2D points to 3D points with the correct z value
      const fullPath = path.map((p) => ({ x: p.x, y: p.y, z: start.z }))

      // Check if this path is valid
      if (this.isValidPath(fullPath)) {
        return fullPath
      }
    }

    // No valid 45-degree path found
    return null
  }

  // Add a path to the result, skipping the first point if it's already added
  private addPathToResult(path: Point[]) {
    if (path.length === 0) return

    for (let i = 0; i < path.length; i++) {
      // Skip the first point if it's already added
      if (
        i === 0 &&
        this.newRoute.length > 0 &&
        this.arePointsEqual(this.newRoute[this.newRoute.length - 1], path[i])
      ) {
        continue
      }
      this.newRoute.push(path[i])
    }
    this.currentStepSize = this.maxStepSize
  }

  moveHead(distance: number) {
    this.lastHeadMoveDistance = distance
    this.headDistanceAlongPath = Math.min(
      this.headDistanceAlongPath + distance,
      this.totalPathLength,
    )
  }

  stepBackAndReduceStepSize() {
    this.headDistanceAlongPath = Math.max(
      this.tailDistanceAlongPath,
      this.headDistanceAlongPath - this.lastHeadMoveDistance,
    )
    this.currentStepSize = Math.max(
      this.minStepSize,
      this.currentStepSize * this.STEP_SIZE_REDUCTION_FACTOR,
    )
  }

  _step() {
    const tailHasReachedEnd = this.tailDistanceAlongPath >= this.totalPathLength
    const headHasReachedEnd = this.headDistanceAlongPath >= this.totalPathLength

    if (tailHasReachedEnd) {
      // Make sure to add the last point if needed
      const lastPoint = this.inputRoute.route[this.inputRoute.route.length - 1]
      if (
        this.newRoute.length === 0 ||
        !this.arePointsEqual(this.newRoute[this.newRoute.length - 1], lastPoint)
      ) {
        // Try to find a valid 45-degree path to the end
        const prevPoint =
          this.newRoute.length > 0
            ? this.newRoute[this.newRoute.length - 1]
            : lastPoint
        const path45 = this.find45DegreePath(prevPoint, lastPoint)
        if (path45 && path45.length > 0) {
          this.addPathToResult(path45)
        } else {
          // Fall back to direct connection
          this.newRoute.push(lastPoint)
        }
      }
      this.solved = true
      return
    }

    if (headHasReachedEnd) {
      const tailPoint = this.getPointAtDistance(this.tailDistanceAlongPath)
      const endPoint = this.inputRoute.route[this.inputRoute.route.length - 1]

      // Try to find a valid 45-degree path
      const path45 = this.find45DegreePath(tailPoint, endPoint)

      if (path45) {
        // Add the path to the result
        this.addPathToResult(path45)
        this.solved = true
        return
      }

      // No valid 45-degree path to the end.
      // Instead of reverting the entire route, try to add remaining points
      // with validation, preserving the simplification work done so far.
      this.lastValidPath = null

      // Get the tail index in the original route
      const tailIndex = this.getNearestIndexForDistance(
        this.tailDistanceAlongPath,
      )

      // Add remaining points from tail to end, validating each segment
      for (let i = tailIndex; i < this.inputRoute.route.length; i++) {
        const point = this.inputRoute.route[i]
        if (
          this.newRoute.length === 0 ||
          !this.arePointsEqual(this.newRoute[this.newRoute.length - 1], point)
        ) {
          // Try to find a valid path to this point
          if (this.newRoute.length > 0) {
            const lastPoint = this.newRoute[this.newRoute.length - 1]
            const segmentPath = this.find45DegreePath(lastPoint, point)
            if (segmentPath && segmentPath.length > 0) {
              // Add the valid path (skipping first point if duplicate)
              for (let j = 0; j < segmentPath.length; j++) {
                if (
                  j === 0 &&
                  this.arePointsEqual(
                    this.newRoute[this.newRoute.length - 1],
                    segmentPath[j],
                  )
                ) {
                  continue
                }
                this.newRoute.push(segmentPath[j])
              }
            } else {
              // No valid path found, add point directly to maintain connectivity
              this.newRoute.push(point)
            }
          } else {
            this.newRoute.push(point)
          }
        }
      }

      this.tailDistanceAlongPath = this.totalPathLength
      this.headDistanceAlongPath = this.totalPathLength
      this.solved = true
      return
    }

    // Increment head distance but don't go past the end of the path
    this.moveHead(this.currentStepSize)

    // Get the points between tail and head distances
    const tailPoint = this.getPointAtDistance(this.tailDistanceAlongPath)
    const headPoint = this.getPointAtDistance(this.headDistanceAlongPath)

    // Check for layer changes between tail and head
    const tailIndex = this.getNearestIndexForDistance(
      this.tailDistanceAlongPath,
    )
    const headIndex = this.getNearestIndexForDistance(
      this.headDistanceAlongPath,
    )

    // If there's a potential layer change in this segment
    let layerChangeBtwHeadAndTail = false
    let layerChangeAtDistance = -1

    for (let i = tailIndex; i < headIndex; i++) {
      if (
        i + 1 < this.inputRoute.route.length &&
        this.inputRoute.route[i].z !== this.inputRoute.route[i + 1].z
      ) {
        layerChangeBtwHeadAndTail = true
        // Find the segment with the layer change
        const changeSegmentIndex = i
        layerChangeAtDistance =
          this.pathSegments[changeSegmentIndex].startDistance
        break
      }
    }

    if (
      layerChangeBtwHeadAndTail &&
      this.lastHeadMoveDistance > this.minStepSize
    ) {
      this.stepBackAndReduceStepSize()
      return
    }

    // Check for jumper pad points between tail and head
    // These points must be preserved exactly like layer changes
    let jumperPadBtwHeadAndTail = false
    let jumperPadAtIndex = -1
    let jumperPadAtDistance = -1

    for (let i = tailIndex + 1; i <= headIndex; i++) {
      if (this.jumperPadPointIndices.has(i)) {
        jumperPadBtwHeadAndTail = true
        jumperPadAtIndex = i
        // Find the distance to this jumper pad point
        if (i > 0 && i - 1 < this.pathSegments.length) {
          jumperPadAtDistance = this.pathSegments[i - 1].endDistance
        } else {
          jumperPadAtDistance = this.pathSegments[0]?.startDistance ?? 0
        }
        break
      }
    }

    if (
      jumperPadBtwHeadAndTail &&
      this.lastHeadMoveDistance > this.minStepSize
    ) {
      this.stepBackAndReduceStepSize()
      return
    }

    // If there's a jumper pad point, handle it (force stop at the pad)
    if (jumperPadBtwHeadAndTail && jumperPadAtIndex >= 0) {
      const jumperPadPoint = this.inputRoute.route[jumperPadAtIndex]

      // 1. Add the last valid path found *before* the jumper pad.
      if (this.lastValidPath) {
        this.addPathToResult(this.lastValidPath)
        this.lastValidPath = null
      }

      // 2. Ensure the route connects *exactly* to the jumper pad location
      const lastPointInNewRoute = this.newRoute[this.newRoute.length - 1]
      if (
        !lastPointInNewRoute ||
        lastPointInNewRoute.x !== jumperPadPoint.x ||
        lastPointInNewRoute.y !== jumperPadPoint.y
      ) {
        // Add the jumper pad point explicitly
        this.newRoute.push({
          x: jumperPadPoint.x,
          y: jumperPadPoint.y,
          z: jumperPadPoint.z,
        })
      }

      // 3. Reset state for the next segment (after the jumper pad)
      this.currentStepSize = this.maxStepSize
      this.tailDistanceAlongPath = jumperPadAtDistance
      this.headDistanceAlongPath = this.tailDistanceAlongPath
      this.lastValidPath = null
      this.lastValidPathHeadDistance = this.tailDistanceAlongPath

      return
    }

    // If there's a layer change, handle it
    // Inside the _step method, within the layer change handling block:
    if (layerChangeBtwHeadAndTail && layerChangeAtDistance > 0) {
      // Get the point *after* the layer change from the original route.
      // This point's XY coordinates define the via location.
      const indexAfterLayerChange =
        this.getNearestIndexForDistance(layerChangeAtDistance) + 1
      const pointAfterChange = this.inputRoute.route[indexAfterLayerChange]
      const viaLocation = { x: pointAfterChange.x, y: pointAfterChange.y }

      // 1. Add the last valid path found *before* the layer change.
      if (this.lastValidPath) {
        this.addPathToResult(this.lastValidPath)
        this.lastValidPath = null // Clear it after adding
      }

      // 2. Ensure the route connects *exactly* to the via location on the *previous* layer.
      const lastPointInNewRoute = this.newRoute[this.newRoute.length - 1]
      if (
        lastPointInNewRoute.x !== viaLocation.x ||
        lastPointInNewRoute.y !== viaLocation.y
      ) {
        // Add a point explicitly connecting to the via XY on the layer we are *leaving*.
        this.newRoute.push({
          x: viaLocation.x,
          y: viaLocation.y,
          z: lastPointInNewRoute.z, // Use the Z of the layer we are leaving
        })
      }
      // If the last point was already at the via location, its Z is correct, so we don't need an else.

      // 3. Add the via itself.
      this.newVias.push(viaLocation)

      // 4. Add the point *after* the layer change, starting the segment on the *new* layer.
      // Ensure this point also uses the precise via location and the *new* Z coordinate.
      this.newRoute.push({
        x: viaLocation.x,
        y: viaLocation.y,
        z: pointAfterChange.z, // Use the Z of the layer we are entering
      })

      // 5. Reset state for the next segment.
      this.currentStepSize = this.maxStepSize

      // Update tail to the start of the segment *after* the layer change point
      const segmentIndexAfterChange = this.pathSegments.findIndex(
        (seg) => seg.start === pointAfterChange,
      )

      if (segmentIndexAfterChange !== -1) {
        this.tailDistanceAlongPath =
          this.pathSegments[segmentIndexAfterChange].startDistance
        this.headDistanceAlongPath = this.tailDistanceAlongPath // Reset head to tail
        this.lastValidPath = null // Ensure lastValidPath is clear
        this.lastValidPathHeadDistance = this.tailDistanceAlongPath
      } else if (indexAfterLayerChange < this.inputRoute.route.length) {
        // Check if it's the last point - if so, we are done as there are no more segments
        if (indexAfterLayerChange === this.inputRoute.route.length - 1) {
          this.solved = true
          return
        }

        // Fallback if the exact segment wasn't found but index is valid
        // This might happen due to floating point comparisons if getPointAtDistance was used previously
        console.warn(
          "Fallback used for tailDistanceAlongPath after layer change",
        )
        const segment = this.pathSegments.find(
          (seg) => seg.start === this.inputRoute.route[indexAfterLayerChange],
        )
        if (segment) {
          this.tailDistanceAlongPath = segment.startDistance
          this.headDistanceAlongPath = this.tailDistanceAlongPath
          this.lastValidPath = null
          this.lastValidPathHeadDistance = this.tailDistanceAlongPath
        } else {
          console.error(
            `[${this.inputRoute.connectionName}] Could not find segment start after layer change. Path might be incomplete.
            Index sought: ${indexAfterLayerChange}, Point: (${this.inputRoute.route[indexAfterLayerChange].x.toFixed(3)}, ${this.inputRoute.route[indexAfterLayerChange].y.toFixed(3)}, z=${this.inputRoute.route[indexAfterLayerChange].z})
            Route Length: ${this.inputRoute.route.length}, Path Segments: ${this.pathSegments.length}`,
          )
          this.solved = true // Prevent infinite loop
        }
      } else {
        // Layer change occurred at the very last point/segment.
        console.warn("Layer change occurred at the end of the path.")
        // The last point on the new layer is already added. We are done.
        this.solved = true
      }

      return // End the step after handling the layer change
    }

    // Try to find a valid 45-degree path from tail to head
    const path45 = this.find45DegreePath(tailPoint, headPoint)

    if (!path45 && this.lastHeadMoveDistance > this.minStepSize) {
      this.stepBackAndReduceStepSize()
      return
    }

    if (!path45 && !this.lastValidPath) {
      const oldTailPoint = this.getPointAtDistance(this.tailDistanceAlongPath)

      // Move tail and head forward by stepSize
      this.tailDistanceAlongPath += this.minStepSize
      this.moveHead(this.minStepSize)

      const newTailIndex = this.getNearestIndexForDistance(
        this.tailDistanceAlongPath,
      )
      const newTailPoint = this.inputRoute.route[newTailIndex]
      const lastRoutePoint =
        this.inputRoute.route[this.inputRoute.route.length - 1]

      // Add the segment from old tail to new tail
      if (
        !this.arePointsEqual(oldTailPoint, newTailPoint) &&
        !this.arePointsEqual(newTailPoint, lastRoutePoint)
      ) {
        // Validate the segment before adding - check if it violates obstacle clearance
        const lastPoint =
          this.newRoute.length > 0
            ? this.newRoute[this.newRoute.length - 1]
            : oldTailPoint

        if (this.isValidPathSegment(lastPoint, newTailPoint)) {
          this.newRoute.push(newTailPoint)
        } else {
          // Segment is invalid - try to find a 45-degree path around the obstacle
          const detourPath = this.find45DegreePath(lastPoint, newTailPoint)
          if (detourPath && detourPath.length > 0) {
            // Found a valid detour, add it (skipping first point if it matches last)
            for (let i = 0; i < detourPath.length; i++) {
              if (
                i === 0 &&
                this.newRoute.length > 0 &&
                this.arePointsEqual(
                  this.newRoute[this.newRoute.length - 1],
                  detourPath[i],
                )
              ) {
                continue
              }
              this.newRoute.push(detourPath[i])
            }
          } else {
            // No valid path found - try nudging the point away from obstacles
            const nudgedPoint = this.nudgePointFromObstacles(newTailPoint)

            // Check if the nudged point gives us a valid path
            if (!this.arePointsEqual(nudgedPoint, newTailPoint)) {
              const nudgedPath = this.find45DegreePath(lastPoint, nudgedPoint)
              if (nudgedPath && nudgedPath.length > 0) {
                // Found a valid path to nudged point
                for (let i = 0; i < nudgedPath.length; i++) {
                  if (
                    i === 0 &&
                    this.newRoute.length > 0 &&
                    this.arePointsEqual(
                      this.newRoute[this.newRoute.length - 1],
                      nudgedPath[i],
                    )
                  ) {
                    continue
                  }
                  this.newRoute.push(nudgedPath[i])
                }
              } else if (this.isValidPathSegment(lastPoint, nudgedPoint)) {
                // Direct path to nudged point is valid
                this.newRoute.push(nudgedPoint)
              } else {
                // Still no valid path - add nudged point as last resort
                this.newRoute.push(nudgedPoint)
              }
            } else {
              // Nudging didn't change the point - try skipping to future waypoints
              // Look for valid paths to subsequent points in the input route
              let foundValidSkip = false
              const maxSkipAttempts = Math.min(
                5,
                this.inputRoute.route.length - newTailIndex - 1,
              )

              for (
                let skipOffset = 1;
                skipOffset <= maxSkipAttempts;
                skipOffset++
              ) {
                const skipIndex = newTailIndex + skipOffset
                if (skipIndex >= this.inputRoute.route.length) break

                const skipPoint = this.inputRoute.route[skipIndex]
                // Skip points that are on different layers
                if (skipPoint.z !== lastPoint.z) continue

                // Try to find a valid path directly to this future point
                const skipPath = this.find45DegreePath(lastPoint, skipPoint)
                if (skipPath && skipPath.length > 0) {
                  // Found a valid path, skip the problematic waypoints
                  for (let i = 0; i < skipPath.length; i++) {
                    if (
                      i === 0 &&
                      this.newRoute.length > 0 &&
                      this.arePointsEqual(
                        this.newRoute[this.newRoute.length - 1],
                        skipPath[i],
                      )
                    ) {
                      continue
                    }
                    this.newRoute.push(skipPath[i])
                  }
                  // Update tail distance to skip the problematic points
                  if (
                    skipIndex < this.pathSegments.length &&
                    this.pathSegments[skipIndex]
                  ) {
                    this.tailDistanceAlongPath =
                      this.pathSegments[skipIndex].startDistance
                  }
                  foundValidSkip = true
                  break
                }
              }

              if (!foundValidSkip) {
                // No valid skip path found - add original as last resort
                this.newRoute.push(newTailPoint)
              }
            }
          }
        }
      }

      return
    }

    if (path45) {
      // Valid 45-degree path found, store it and continue expanding
      this.lastValidPath = path45
      this.lastValidPathHeadDistance = this.headDistanceAlongPath
      return
    }

    // No valid path found, use the last valid path and reset
    if (this.lastValidPath) {
      this.addPathToResult(this.lastValidPath)
      this.lastValidPath = null
      this.tailDistanceAlongPath = this.lastValidPathHeadDistance
      this.moveHead(this.minStepSize)
    }
  }

  visualize(): GraphicsObject {
    const graphics = this.getVisualsForNewRouteAndObstacles()

    // Highlight current head and tail positions
    const tailPoint = this.getPointAtDistance(this.tailDistanceAlongPath)
    const headPoint = this.getPointAtDistance(this.headDistanceAlongPath)

    graphics.points.push({
      x: tailPoint.x,
      y: tailPoint.y,
      color: "yellow",
      label: ["Tail", `z: ${tailPoint.z}`].join("\n"),
    })

    graphics.points.push({
      x: headPoint.x,
      y: headPoint.y,
      color: "orange",
      label: ["Head", `z: ${headPoint.z}`].join("\n"),
    })

    const tentativeHead = this.getPointAtDistance(
      this.headDistanceAlongPath + this.currentStepSize,
    )
    graphics.points.push({
      x: tentativeHead.x,
      y: tentativeHead.y,
      color: "red",
      label: ["Tentative Head", `z: ${tentativeHead.z}`].join("\n"),
    })

    // Add visualization of the path segments
    let distance = 0
    while (distance < this.totalPathLength) {
      const point = this.getPointAtDistance(distance)
      graphics.circles.push({
        center: {
          x: point.x,
          y: point.y,
        },
        radius: 0.05,
        fill: "rgba(100, 100, 100, 0.5)",
      })
      distance += this.totalPathLength / 20 // Show 20 markers along the path
    }

    // Visualize the current prospective 45-degree path from tail to head
    if (this.lastValidPath && this.lastValidPath.length > 1) {
      // Draw the path in a bright cyan color to make it stand out
      for (let i = 0; i < this.lastValidPath.length - 1; i++) {
        graphics.lines.push({
          points: [
            { x: this.lastValidPath[i].x, y: this.lastValidPath[i].y },
            {
              x: this.lastValidPath[i + 1].x,
              y: this.lastValidPath[i + 1].y,
            },
          ],
          strokeColor: "rgba(0, 255, 255, 0.9)", // Bright cyan
          strokeDash: "3, 3", // Dashed line to indicate it's a prospective path
        })
      }
    }

    return graphics
  }
}
