import type { GraphicsObject } from "graphics-debug"
import { type Mesh, SearchInstance, distance, type Point } from "polyanya"
import { BaseSolver } from "../BaseSolver"
import type { SimpleRouteJson } from "../../types"
import type { PolyanyaPathResult } from "./types"

export class PolyanyaPathSolver extends BaseSolver {
  mesh: Mesh
  srj: SimpleRouteJson
  colorMap: Record<string, string>
  minTraceWidth: number
  results: PolyanyaPathResult[] = []

  private sortedConnections: Array<{
    name: string
    start: Point
    end: Point
    euclidean: number
  }> = []
  private connectionIndex = 0

  constructor(params: {
    mesh: Mesh
    srj: SimpleRouteJson
    colorMap: Record<string, string>
    minTraceWidth: number
  }) {
    super()
    this.mesh = params.mesh
    this.srj = params.srj
    this.colorMap = params.colorMap
    this.minTraceWidth = params.minTraceWidth
    this.MAX_ITERATIONS = params.srj.connections.length + 10

    // Sort connections shortest-first (Euclidean between endpoints)
    this.sortedConnections = params.srj.connections
      .map((conn) => {
        const pts = conn.pointsToConnect
        const a = { x: pts[0]!.x, y: pts[0]!.y }
        const b = { x: pts[pts.length - 1]!.x, y: pts[pts.length - 1]!.y }
        return {
          name: conn.name,
          start: a,
          end: b,
          euclidean: distance(a, b),
        }
      })
      .sort((a, b) => a.euclidean - b.euclidean)
  }

  _step() {
    if (this.connectionIndex >= this.sortedConnections.length) {
      this.solved = true
      return
    }

    const conn = this.sortedConnections[this.connectionIndex]!
    this.connectionIndex++
    this.progress = this.connectionIndex / this.sortedConnections.length

    const searchInstance = new SearchInstance(this.mesh)
    searchInstance.setStartGoal(conn.start, conn.end)
    const found = searchInstance.search()

    let path: Point[]
    let cost: number
    if (found) {
      path = searchInstance.getPathPoints()
      cost = searchInstance.getCost()
    } else {
      // Fallback to direct line — mesh may be incomplete (0 polygons)
      console.warn(
        `[PolyanyaPathSolver] search() failed for "${conn.name}" — falling back to direct line. Mesh may be incomplete.`,
      )
      path = [conn.start, conn.end]
      cost = conn.euclidean
    }

    this.results.push({
      connectionName: conn.name,
      path,
      cost,
    })
  }

  getResults(): PolyanyaPathResult[] {
    return this.results
  }

  visualize(): GraphicsObject {
    const lines: GraphicsObject["lines"] = []
    const points: GraphicsObject["points"] = []

    for (const result of this.results) {
      const color = this.colorMap[result.connectionName] ?? "blue"
      if (result.path.length > 1) {
        lines.push({
          points: result.path.map((p) => ({ x: p.x, y: p.y })),
          strokeColor: color,
          strokeWidth: 0.05,
        })
      }
      // Mark start and goal
      if (result.path.length > 0) {
        points.push({
          x: result.path[0]!.x,
          y: result.path[0]!.y,
          color,
          label: result.connectionName,
        })
        points.push({
          x: result.path[result.path.length - 1]!.x,
          y: result.path[result.path.length - 1]!.y,
          color,
        })
      }
    }

    return { lines, points }
  }
}
