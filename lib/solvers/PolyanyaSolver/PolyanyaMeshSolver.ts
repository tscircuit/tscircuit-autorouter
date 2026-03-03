import type { GraphicsObject } from "graphics-debug"
import {
  type Mesh,
  cdtTriangulate,
  rectToPolygon,
  buildMeshFromRegions,
  mergeMesh,
  type Point,
} from "polyanya"
import { BaseSolver } from "../BaseSolver"
import type { SimpleRouteJson } from "../../types"
import { mergeOverlappingRects } from "./mergeOverlappingRects"

export class PolyanyaMeshSolver extends BaseSolver {
  mesh: Mesh | null = null
  obstaclePolygons: Point[][] = []
  srj: SimpleRouteJson
  margin: number

  constructor(srj: SimpleRouteJson, margin: number) {
    super()
    this.srj = srj
    this.margin = margin
  }

  _step() {
    // Convert each obstacle to a polygon with margin
    const expandedPolygons = this.srj.obstacles.map((obs) =>
      rectToPolygon(
        obs.center.x,
        obs.center.y,
        obs.width,
        obs.height,
        this.margin,
      ),
    )

    // Merge overlapping expanded polygons to avoid intersecting constraint edges
    // that would break cdt2d triangulation
    this.obstaclePolygons = mergeOverlappingRects(expandedPolygons)

    // Triangulate free space around obstacles
    const cdtResult = cdtTriangulate({
      bounds: this.srj.bounds,
      obstacles: this.obstaclePolygons,
    })

    // Build navmesh from triangle regions
    const rawMesh = buildMeshFromRegions(cdtResult)

    // Merge into larger convex polygons for faster search
    this.mesh = mergeMesh(rawMesh)

    this.solved = true
  }

  getMesh(): Mesh {
    if (!this.mesh) throw new Error("Mesh not built yet")
    return this.mesh
  }

  visualize(): GraphicsObject {
    const lines: GraphicsObject["lines"] = []
    const rects: GraphicsObject["rects"] = []

    // Draw obstacle polygons as red semi-transparent rects
    for (const obs of this.srj.obstacles) {
      rects.push({
        center: obs.center,
        width: obs.width,
        height: obs.height,
        fill: "rgba(255,0,0,0.15)",
        stroke: "rgba(255,0,0,0.5)",
      })
    }

    // Draw mesh polygon edges as faint lines
    if (this.mesh) {
      for (const polygon of this.mesh.polygons) {
        if (polygon.vertices.length < 2) continue
        const pts: { x: number; y: number }[] = []
        for (const vIdx of polygon.vertices) {
          const v = this.mesh.vertices[vIdx]
          if (v) pts.push({ x: v.p.x, y: v.p.y })
        }
        // Close the polygon
        if (pts.length > 0) pts.push({ ...pts[0]! })
        lines.push({
          points: pts,
          strokeColor: "rgba(100,100,255,0.2)",
          strokeWidth: 0.02,
        })
      }
    }

    // Draw bounds border
    const { minX, maxX, minY, maxY } = this.srj.bounds
    lines.push({
      points: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
        { x: minX, y: minY },
      ],
      strokeColor: "rgba(255,0,0,0.25)",
    })

    return { lines, rects }
  }
}
