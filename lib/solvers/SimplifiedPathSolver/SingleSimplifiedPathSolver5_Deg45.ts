import {
  doSegmentsIntersect,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
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

    // Compute path segments and total length
    this.computePathSegments()
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

  // Check if a path segment is valid
  isValidPathSegment(start: Point, end: Point): boolean {
    // Check if the segment intersects with any obstacle
    for (const obstacle of this.filteredObstacles) {
      if (!obstacle.zLayers?.includes(start.z)) {
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
        // TODO find path from tail to end w/ 45 degree paths
        this.newRoute.push(lastPoint)
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

      // No valid 45-degree path to the end. Revert to the original
      // geometry for this segment to guarantee connectivity.
      this.lastValidPath = null
      this.tailDistanceAlongPath = this.totalPathLength
      this.headDistanceAlongPath = this.totalPathLength

      const dedupedOriginalRoute: Point[] = []
      for (const point of this.inputRoute.route) {
        if (
          dedupedOriginalRoute.length === 0 ||
          !this.arePointsEqual(
            dedupedOriginalRoute[dedupedOriginalRoute.length - 1],
            point,
          )
        ) {
          dedupedOriginalRoute.push(point)
        }
      }

      this.newRoute = dedupedOriginalRoute
      this.newVias = [...this.inputRoute.vias]

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
            "Could not find segment start after layer change, path might be incomplete.",
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
        this.newRoute.push(newTailPoint)
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
