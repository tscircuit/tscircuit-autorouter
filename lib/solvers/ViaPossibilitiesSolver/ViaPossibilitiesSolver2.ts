import { NodeWithPortPoints } from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import { GraphicsObject } from "graphics-debug"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import {
  Bounds,
  distance,
  midpoint,
  Point,
  Point3,
  pointToSegmentDistance,
  getSegmentIntersection,
  segmentToSegmentMinDistance,
  clamp,
} from "@tscircuit/math-utils"
import { getPortPairMap, PortPairMap } from "lib/utils/getPortPairs"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
import { cloneAndShuffleArray } from "lib/utils/cloneAndShuffleArray"
import { safeTransparentize } from "../colors"

export type ConnectionName = string

export interface Segment {
  start: Point3
  end: Point3
  connectionName: string
}

export interface ViaPossibilities2HyperParameters {
  SHUFFLE_SEED?: number
} /**
This solver uses an intersection-based approach. Here's how it works:
0. Prepare placeholderPaths
- Placeholder paths go from (start, end) if the z is the same
- For placeholder paths, if the Z is different between the start and the end, then we create two segments, (start, mid) with start.z and (mid,end) with end.z. This means the placeholder path has four points, the second and third point are both a the mid XY but have a different z
1. We cycle through each port pair, we start by setting currentHead = start for the first pair
2. We have a currentHead, currentPath and currentConnectionName
STEP LOOP:
3. We always try to move the currentHead to the end. We try to create a line from currentHead to the end
4. If the currentHead does any of the following:
   - Intersects a previously created path
   - Intersects a placeholder path
   - (check last) is not on the same z as the end
   Then we must insert a via (2 points with a z change). Insert this via at the midpoint of currentHead and the intersection point (or the end if the "is not same z as end" condition applies)
   In the next iteration of the step function we'll go back to step 3
5. After the currentPath reaches the end for the connection, we delete the placeholder path and select the next currentHead by popping the unprocessedConnections, reset currentPath and set currentConnectionName
6. When there are no more unprocessed connections, we set this.solved = true
*/
export class ViaPossibilitiesSolver2 extends BaseSolver {
  bounds: Bounds
  maxViaCount: number
  portPairMap: PortPairMap
  colorMap: Record<string, string>
  nodeWidth: number
  availableZ: number[]
  hyperParameters: ViaPossibilities2HyperParameters
  VIA_INTERSECTION_BUFFER_DISTANCE = 0.05
  PLACEHOLDER_WALL_BUFFER_DISTANCE = 0.1
  NEW_HEAD_WALL_BUFFER_DISTANCE = 0.05

  unprocessedConnections: ConnectionName[]

  completedPaths: Map<ConnectionName, Point3[]> = new Map()
  placeholderPaths: Map<ConnectionName, Point3[]> = new Map()

  currentHead: Point3
  currentConnectionName: ConnectionName
  currentPath: Point3[]
  currentViaCount: number

  constructor({
    nodeWithPortPoints,
    colorMap,
    hyperParameters,
  }: {
    nodeWithPortPoints: NodeWithPortPoints
    colorMap?: Record<string, string>
    hyperParameters?: ViaPossibilities2HyperParameters
  }) {
    super()
    this.MAX_ITERATIONS = 100e3
    this.colorMap =
      colorMap ?? generateColorMapFromNodeWithPortPoints(nodeWithPortPoints)
    this.maxViaCount = 5
    this.bounds = getBoundsFromNodeWithPortPoints(nodeWithPortPoints)
    this.nodeWidth = this.bounds.maxX - this.bounds.minX
    this.portPairMap = getPortPairMap(nodeWithPortPoints)
    this.stats.solutionsFound = 0
    this.availableZ = nodeWithPortPoints.availableZ ?? [0, 1]
    this.hyperParameters = hyperParameters ?? {
      SHUFFLE_SEED: 0,
    }

    this.unprocessedConnections = Array.from(this.portPairMap.keys()).sort()
    if (hyperParameters?.SHUFFLE_SEED) {
      this.unprocessedConnections = cloneAndShuffleArray(
        this.unprocessedConnections,
        hyperParameters.SHUFFLE_SEED,
      )
    }

    // Generate placeholder paths
    for (const [connectionName, { start, end }] of this.portPairMap.entries()) {
      if (start.z === end.z) {
        const isVertical = Math.abs(start.x - end.x) < 1e-9 // Use tolerance for float comparison
        const isHorizontal = Math.abs(start.y - end.y) < 1e-9

        if (isVertical || isHorizontal) {
          this.placeholderPaths.set(connectionName, [
            start,
            this._padByPlaceholderWallBuffer(start),
            this._padByPlaceholderWallBuffer(end),
            end,
          ])
        } else {
          // Diagonal line on the same Z plane
          this.placeholderPaths.set(connectionName, [start, end])
        }
      } else {
        // Create a path with a Z change at the midpoint for different Z levels
        const midX = (start.x + end.x) / 2
        const midY = (start.y + end.y) / 2

        // Use the (potentially offset) midpoint XY for the Z change points
        const midStart: Point3 = this._padByPlaceholderWallBuffer({
          x: midX,
          y: midY,
          z: start.z,
        })
        const midEnd: Point3 = this._padByPlaceholderWallBuffer({
          x: midX,
          y: midY,
          z: end.z,
        })
        this.placeholderPaths.set(connectionName, [
          start,
          this._padByPlaceholderWallBuffer(start),
          midStart,
          midEnd,
          this._padByPlaceholderWallBuffer(end),
          end,
        ])
      }
    }

    this.currentConnectionName = this.unprocessedConnections.pop()!
    const start = this.portPairMap.get(this.currentConnectionName)!.start
    this.currentHead = this._padByNewHeadWallBuffer(start)
    this.currentPath = [start, this.currentHead]
    this.currentViaCount = 0
    this.placeholderPaths.delete(this.currentConnectionName) // Delete placeholder when we start processing
  }

  _padByNewHeadWallBuffer(point: Point3) {
    return {
      x: clamp(
        point.x,
        this.bounds.minX + this.NEW_HEAD_WALL_BUFFER_DISTANCE,
        this.bounds.maxX - this.NEW_HEAD_WALL_BUFFER_DISTANCE,
      ),
      y: clamp(
        point.y,
        this.bounds.minY + this.NEW_HEAD_WALL_BUFFER_DISTANCE,
        this.bounds.maxY - this.NEW_HEAD_WALL_BUFFER_DISTANCE,
      ),
      z: point.z,
    }
  }

  _padByPlaceholderWallBuffer(point: Point3) {
    return {
      x: clamp(
        point.x,
        this.bounds.minX + this.PLACEHOLDER_WALL_BUFFER_DISTANCE,
        this.bounds.maxX - this.PLACEHOLDER_WALL_BUFFER_DISTANCE,
      ),
      y: clamp(
        point.y,
        this.bounds.minY + this.PLACEHOLDER_WALL_BUFFER_DISTANCE,
        this.bounds.maxY - this.PLACEHOLDER_WALL_BUFFER_DISTANCE,
      ),
      z: point.z,
    }
  }

  _step() {
    if (this.solved) return

    const targetEnd = this.portPairMap.get(this.currentConnectionName)!.end
    const proposedSegment: [Point3, Point3] = [this.currentHead, targetEnd]

    let closestIntersection: any = null
    let intersectedSegmentZ: number | null = null

    const checkIntersectionsWithPathMap = (
      pathMap: Map<ConnectionName, Point3[]>,
    ) => {
      for (const path of pathMap.values()) {
        for (let i = 0; i < path.length - 1; i++) {
          const segment: [Point3, Point3] = [path[i], path[i + 1]]
          // Skip checking intersection if segment is just a via (z change)
          if (segment[0].x === segment[1].x && segment[0].y === segment[1].y) {
            continue
          }
          // Only check intersections on the same Z plane as the proposed move start
          // Or if the proposed move itself involves a Z change (handled later)
          if (segment[0].z !== this.currentHead.z) {
            continue
          }

          const intersection = getSegmentIntersection(
            proposedSegment[0],
            proposedSegment[1],
            segment[0],
            segment[1],
          )
          if (intersection) {
            // Ignore intersection if it's exactly at the start point (currentHead)
            const distToIntersection = distance(this.currentHead, intersection)
            if (distToIntersection < 1e-6) continue // Tolerance for floating point

            if (
              !closestIntersection ||
              distToIntersection < closestIntersection.dist
            ) {
              closestIntersection = {
                point: intersection,
                dist: distToIntersection,
              }
              intersectedSegmentZ = segment[0].z // Z level of the segment we hit
            }
          }
        }
      }
    }

    // Check intersections against completed and placeholder paths
    checkIntersectionsWithPathMap(this.completedPaths)
    checkIntersectionsWithPathMap(this.placeholderPaths)

    const needsZChange = this.currentHead.z !== targetEnd.z

    if (closestIntersection || needsZChange) {
      this.currentViaCount++

      // Check if adding this via would exceed the limit
      if (this.currentViaCount >= this.maxViaCount) {
        this.failed = true
        return
      }
    }

    if (closestIntersection) {
      // --- Intersection Found ---
      let viaXY: Point
      const distToIntersection = closestIntersection.dist

      if (distToIntersection <= this.VIA_INTERSECTION_BUFFER_DISTANCE + 1e-6) {
        // If intersection is too close, place via at midpoint
        viaXY = midpoint(this.currentHead, closestIntersection.point)
      } else {
        // Otherwise, place via VIA_INTERSECTION_BUFFER_DISTANCE before the intersection point
        const intersectionPoint = closestIntersection.point
        const vectorX = intersectionPoint.x - this.currentHead.x
        const vectorY = intersectionPoint.y - this.currentHead.y
        // Calculate the point VIA_INTERSECTION_BUFFER_DISTANCE away from the intersection towards the current head
        const ratio =
          (distToIntersection - this.VIA_INTERSECTION_BUFFER_DISTANCE) /
          distToIntersection
        viaXY = {
          x: this.currentHead.x + vectorX * ratio,
          y: this.currentHead.y + vectorY * ratio,
        }
      }

      // Determine the Z level to switch to (the one NOT occupied by the intersected segment)
      const nextZ = this.availableZ.find((z) => z !== intersectedSegmentZ)!
      if (nextZ === undefined) {
        console.error("Could not determine next Z level for via placement!")
        this.failed = true // Mark as failed if Z logic breaks
        return
      }

      const viaPoint1: Point3 = { ...viaXY, z: this.currentHead.z }
      const viaPoint2: Point3 = { ...viaXY, z: nextZ }

      this.currentPath.push(viaPoint1, viaPoint2)
      this.currentHead = viaPoint2
    } else if (needsZChange) {
      // --- No Intersection, but Z Mismatch ---
      let viaXY: Point
      const distToTarget = distance(this.currentHead, targetEnd)

      if (distToTarget < this.VIA_INTERSECTION_BUFFER_DISTANCE) {
        // If target is too close, place via at midpoint
        viaXY = midpoint(this.currentHead, targetEnd)
      } else {
        // Otherwise, place via VIA_INTERSECTION_BUFFER_DISTANCE before the target end point
        const vectorX = targetEnd.x - this.currentHead.x
        const vectorY = targetEnd.y - this.currentHead.y
        // Calculate the point VIA_INTERSECTION_BUFFER_DISTANCE away from the target towards the current head
        const ratio =
          (distToTarget - this.VIA_INTERSECTION_BUFFER_DISTANCE) / distToTarget
        viaXY = {
          x: this.currentHead.x + vectorX * ratio,
          y: this.currentHead.y + vectorY * ratio,
        }
      }

      const nextZ = targetEnd.z // Target the destination Z

      const viaPoint1: Point3 = { ...viaXY, z: this.currentHead.z }
      const viaPoint2: Point3 = { ...viaXY, z: nextZ }

      this.currentPath.push(viaPoint1, viaPoint2)
      this.currentHead = viaPoint2
    } else {
      // --- No Intersection, Z Matches: Path Clear ---
      this.currentPath.push(targetEnd)
      this.completedPaths.set(this.currentConnectionName, this.currentPath)

      if (this.unprocessedConnections.length === 0) {
        // All connections processed
        this.solved = true
        this.stats.solutionsFound = 1 // Mark as solved
      } else {
        // Start next connection
        this.currentConnectionName = this.unprocessedConnections.pop()!
        const { start } = this.portPairMap.get(this.currentConnectionName)!
        this.currentHead = this._padByNewHeadWallBuffer(start)
        this.currentPath = [start, this.currentHead]
        this.currentViaCount = 0
        this.placeholderPaths.delete(this.currentConnectionName) // Remove placeholder
      }
    }
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      points: [],
      lines: [],
      circles: [],
      rects: [],
      title: "Via Possibilities Solver State",
      coordinateSystem: "cartesian",
    }

    // Generate a simple color map
    const colorMap = this.colorMap

    // 1. Draw Node Bounds
    graphics.lines!.push({
      points: [
        { x: this.bounds.minX, y: this.bounds.minY },
        { x: this.bounds.maxX, y: this.bounds.minY },
        { x: this.bounds.maxX, y: this.bounds.maxY },
        { x: this.bounds.minX, y: this.bounds.maxY },
        { x: this.bounds.minX, y: this.bounds.minY },
      ],
      strokeColor: "gray",
      strokeWidth: 0.01,
    })

    // Draw Start/End points from portPairMap
    for (const [connectionName, { start, end }] of this.portPairMap.entries()) {
      const color = this.colorMap[connectionName] ?? "black"
      graphics.points!.push({
        x: start.x,
        y: start.y,
        color: color,
        label: `Port: ${connectionName} Start (z${start.z})`,
      })
      graphics.points!.push({
        x: end.x,
        y: end.y,
        color: color,
        label: `Port: ${connectionName} End (z${end.z})`,
      })
    }

    const drawPath = (
      pathMap: Map<ConnectionName, Point3[]>,
      labelPrefix: string,
    ) => {
      for (const [connectionName, path] of pathMap.entries()) {
        const color = colorMap[connectionName] ?? "black"
        for (let i = 0; i < path.length - 1; i++) {
          const p1 = path[i]
          const p2 = path[i + 1]

          if (p1.x === p2.x && p1.y === p2.y && p1.z !== p2.z) {
            // Draw Via for Z change
            graphics.circles!.push({
              center: { x: p1.x, y: p1.y },
              radius: 0.3, // Diameter 0.6
              fill: safeTransparentize(color, 0.5),
              label: `${labelPrefix}: ${connectionName} Via (z${p1.z}->z${p2.z})`,
            })
          } else {
            // Draw Line Segment
            graphics.lines!.push({
              points: [p1, p2],
              strokeColor: safeTransparentize(color, 0.5),
              strokeDash: p1.z === 0 ? undefined : [0.1, 0.1],
              strokeWidth: 0.1,
              label: `${labelPrefix}: ${connectionName} (z${p1.z})`,
            })
          }
        }
      }
    }

    // 2. Draw Placeholder Paths
    drawPath(this.placeholderPaths, "Placeholder")

    // 3. Draw Completed Paths
    drawPath(this.completedPaths, "Completed")

    // 4. Draw Current Path (if any)
    if (this.currentPath && this.currentPath.length > 0) {
      const color = colorMap[this.currentConnectionName] ?? "orange" // Use a distinct color
      for (let i = 0; i < this.currentPath.length - 1; i++) {
        const p1 = this.currentPath[i]
        const p2 = this.currentPath[i + 1]
        if (p1.x === p2.x && p1.y === p2.y && p1.z !== p2.z) {
          graphics.circles!.push({
            center: { x: p1.x, y: p1.y },
            radius: 0.3,
            fill: safeTransparentize(color, 0.5),
            label: `Current: ${this.currentConnectionName} Via (z${p1.z}->z${p2.z})`,
          })
        } else {
          graphics.lines!.push({
            points: [p1, p2],
            strokeColor: safeTransparentize(color, 0.5),
            strokeWidth: 0.15, // Thicker
            strokeDash: "2,2", // Dashed
            label: `Current: ${this.currentConnectionName} (z${p1.z})`,
          })
        }
      }
      // Highlight current head
      graphics.points!.push({
        x: this.currentHead.x,
        y: this.currentHead.y,
        color: "green",
        label: `Current Head: ${this.currentConnectionName} (z${this.currentHead.z})`,
      })
    }

    return graphics
  }
}
