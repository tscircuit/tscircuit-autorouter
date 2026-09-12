import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"
import type { GraphicsObject } from "graphics-debug"
import type { SegmentTree } from "lib/data-structures/SegmentTree"
import { SingleSimplifiedPathSolver } from "./SingleSimplifiedPathSolver"
import { TraceSimplificationSolverAdapter } from "../../bindings/trace-simplification/TraceSimplificationSolverAdapter"
interface Point { x: number; y: number; z: number }
interface PathSegment { start: Point; end: Point; length: number; startDistance: number; endDistance: number }
export class SingleSimplifiedPathSolver5 extends SingleSimplifiedPathSolver {
  static override solverKind = "path"
  static override stateFields = [...SingleSimplifiedPathSolver.stateFields, "pathSegments", "totalPathLength", "headDistanceAlongPath", "tailDistanceAlongPath", "minStepSize", "lastValidPath", "lastValidPathHeadDistance", "STEP_SIZE_REDUCTION_FACTOR", "maxStepSize", "currentStepSize", "lastHeadMoveDistance", "cachedValidPathSegments", "filteredObstacles", "filteredObstaclePathSegments", "traceThicknessByObstacleSegmentId", "filteredVias", "filteredJumperPads", "jumperPadPointIndices", "segmentTree", "OBSTACLE_MARGIN", "TRACE_THICKNESS", "useTraceWidthAwareClearance", "clearanceTraceThickness", "TAIL_JUMP_RATIO"]
  declare private pathSegments: PathSegment[]
  declare private totalPathLength: number
  declare private headDistanceAlongPath: number
  declare private tailDistanceAlongPath: number
  declare private minStepSize: number
  declare private lastValidPath: Point[] | null
  declare private lastValidPathHeadDistance: number
  declare STEP_SIZE_REDUCTION_FACTOR: number
  declare maxStepSize: number
  declare currentStepSize: number
  declare lastHeadMoveDistance: number
  declare cachedValidPathSegments: Set<string>
  declare filteredObstacles: Obstacle[]
  declare filteredObstaclePathSegments: Array<[Point, Point]>
  declare traceThicknessByObstacleSegmentId: Map<string, number>
  declare filteredVias: Array<{ x: number; y: number; diameter: number }>
  declare filteredJumperPads: Array<{ center: { x: number; y: number }; width: number; height: number; connectionName: string }>
  declare jumperPadPointIndices: Set<number>
  declare segmentTree: SegmentTree
  declare OBSTACLE_MARGIN: number
  declare TRACE_THICKNESS: number
  declare private useTraceWidthAwareClearance: boolean
  declare private clearanceTraceThickness: number
  declare TAIL_JUMP_RATIO: number
  constructor(params: ConstructorParameters<typeof SingleSimplifiedPathSolver>[0] & { useTraceWidthAwareClearance?: boolean }) { super(params) }
  private isSameNetRoute(otherRoute: HighDensityIntraNodeRoute): boolean { return this.invoke("isSameNetRoute", [otherRoute]) }
  private computePathSegments(): void { this.invoke("computePathSegments") }
  private arePointsEqual(a: Point, b: Point): boolean { return this.invoke("arePointsEqual", [a, b]) }
  private getPointAtDistance(distance: number): Point { return this.invoke("getPointAtDistance", [distance]) }
  private getNearestIndexForDistance(distance: number): number { return this.invoke("getNearestIndexForDistance", [distance]) }
  isValidPathSegment(start: Point, end: Point): boolean { return this.invoke("isValidPathSegment", [start, end]) }
  override isValidPath(points: Point[]): boolean { return this.invoke("isValidPath", [points]) }
  private find45DegreePath(start: Point, end: Point): Point[] | null { return this.invoke("find45DegreePath", [start, end]) }
  private addPathToResult(path: Point[]): void { this.invoke("addPathToResult", [path]) }
  private appendOriginalRouteSlice(startDistance: number, endIndexInclusive: number): void { this.invoke("appendOriginalRouteSlice", [startDistance, endIndexInclusive]) }
  moveHead(distance: number): void { this.invoke("moveHead", [distance]) }
  stepBackAndReduceStepSize(): void { this.invoke("stepBackAndReduceStepSize") }
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
TraceSimplificationSolverAdapter.register("path", SingleSimplifiedPathSolver5)
