import type { GraphicsObject, Line } from "graphics-debug"
import {
  type Mesh,
  type Point,
  type WeightedRegion,
  VisibilityGraph,
  SearchInstance,
  cdtTriangulate,
  rectToPolygon,
  buildMeshFromRegions,
  mergeMesh,
} from "polyanya"
import { BaseSolver } from "../BaseSolver"
import type { SimpleRouteJson } from "../../types"
import type { ResolvedPath } from "./types"
import { mergeOverlappingRects } from "./mergeOverlappingRects"

const TRACE_WEIGHT = 10
const TRACE_PENALTY = 25

// Phase ordering: shortest-first by default, longest-first available as option
type Phase = "shortest" | "longest" | "done"

/**
 * Greedy sequential path solver: routes one trace at a time using the
 * visibility graph algorithm. Each committed trace is written as either
 * a hard obstacle or a weighted penalty region (configurable via
 * `useObstacles`) so future traces avoid it.
 *
 * Supports multiple layers. Layer 0 ("top") has all top-layer SRJ obstacles.
 * Layer 1+ only have obstacles present on that layer (vias, through-hole
 * pins, and traces routed on that layer). When a trace can't route on
 * layer 0, it falls back to layer 1. If it can't route on any layer,
 * it triggers the shortest→longest phase fallback.
 *
 * Tries shortest-first ordering. If it gets stuck, resets and tries
 * longest-first, then keeps whichever routed more traces. When stuck
 * on all layers, adds a new layer (up to maxLayerCount) before giving up.
 */
export class GreedySequentialPathSolver extends BaseSolver {
  private srj: SimpleRouteJson
  private colorMap: Record<string, string>
  private minTraceWidth: number
  private margin: number
  private viaDiameter: number
  private layerCount: number

  /** When true, committed traces become hard obstacles and the mesh is
   *  rebuilt after each trace. When false, traces become weighted regions
   *  and the mesh is built once. */
  private useObstacles: boolean

  /** When true, use Polyanya SearchInstance for pathfinding (no weighted
   *  regions). When false, use VisibilityGraph (supports weighted regions). */
  private usePolyanya: boolean

  /** All connections (immutable reference for resets) */
  private allConnections: Array<{
    name: string
    start: Point
    end: Point
    originalStart: Point
    originalEnd: Point
    startCandidates: Point[]
    endCandidates: Point[]
  }>

  /** Connections still waiting to be routed */
  private remaining: Array<{
    name: string
    start: Point
    end: Point
    originalStart: Point
    originalEnd: Point
    startCandidates: Point[]
    endCandidates: Point[]
  }>

  /** Per-layer base obstacle polygons from original SRJ only (for resets) */
  private baseObstaclePolygons: Point[][][]

  /** Per-layer rect obstacle polygons (base rects + via rects, merged before CDT) */
  private rectObstacles: Point[][][] = []

  /** Per-layer trace obstacle polygons (thick polyline offsets, passed directly to CDT without merging) */
  private tracePolygonObstacles: Point[][][] = []

  /** Per-layer weighted regions from committed traces (only used when !useObstacles) */
  private traceWeightedRegions: WeightedRegion[][] = []

  /** Per-layer meshes */
  private meshes: (Mesh | null)[] = []

  /** Committed results */
  private resolvedPaths: ResolvedPath[] = []

  /** Visualization: trace obstacle polygons (with layer info) */
  private traceObstaclePolys: Array<{
    polygon: Point[]
    connectionName: string
    layerZ: number
  }> = []

  /** Current ordering phase */
  private phase: Phase = "shortest"

  /** Best results across all phases */
  private bestResults: ResolvedPath[] | null = null
  private bestObstaclePolys: typeof this.traceObstaclePolys | null = null

  /** Maximum layers allowed by the SRJ */
  private maxLayerCount: number

  /** Points shared by multiple connections (no endcap clearance here) */
  private sharedPoints: Set<string>

  /** Time tracking for timeout guard */
  private solveStartTime: number = 0
  private static MAX_SOLVE_TIME_MS = 30_000

  /** Total connections for progress tracking */
  private totalConnections: number

  constructor(params: {
    srj: SimpleRouteJson
    colorMap: Record<string, string>
    minTraceWidth: number
    margin: number
    useObstacles?: boolean
    usePolyanya?: boolean
  }) {
    super()
    this.srj = params.srj
    this.colorMap = params.colorMap
    this.minTraceWidth = params.minTraceWidth
    this.margin = params.margin
    this.useObstacles = params.useObstacles ?? true
    this.usePolyanya = params.usePolyanya ?? true
    this.maxLayerCount = Math.max(1, params.srj.layerCount ?? 2)
    this.layerCount = 1 // Start with 1 layer, expand when stuck
    this.viaDiameter = params.srj.minViaDiameter ?? 0.6

    // Build per-layer base obstacle polygons for ALL possible layers upfront
    // (so layer names remain stable when layerCount grows dynamically)
    const allLayerNames = this.getAllLayerNames()
    this.baseObstaclePolygons = []
    for (let z = 0; z < this.maxLayerCount; z++) {
      const layerName = allLayerNames[z]!
      const layerObstacles = params.srj.obstacles.filter((obs) =>
        obs.layers.includes(layerName),
      )
      const expandedPolygons = layerObstacles.map((obs) =>
        rectToPolygon(
          obs.center.x,
          obs.center.y,
          obs.width,
          obs.height,
          this.margin,
        ),
      )
      this.baseObstaclePolygons.push(expandedPolygons)
    }

    // Initialize per-layer state (only for active layers)
    this.rectObstacles = this.baseObstaclePolygons.slice(0, this.layerCount).map((polys) => [...polys])
    this.tracePolygonObstacles = Array.from({ length: this.layerCount }, () => [])
    this.traceWeightedRegions = Array.from({ length: this.layerCount }, () => [])
    this.meshes = Array.from({ length: this.layerCount }, () => null)

    // Build meshes for active layers only
    for (let z = 0; z < this.layerCount; z++) {
      this.buildMesh(z)
    }

    // Detect points shared by multiple connections (junctions — no endcap)
    const pointCounts = new Map<string, number>()
    for (const conn of params.srj.connections) {
      for (const pt of conn.pointsToConnect) {
        const key = `${pt.x},${pt.y}`
        pointCounts.set(key, (pointCounts.get(key) ?? 0) + 1)
      }
    }
    this.sharedPoints = new Set<string>()
    for (const [key, count] of pointCounts) {
      if (count > 1) this.sharedPoints.add(key)
    }

    this.allConnections = params.srj.connections.map((conn) => {
      const pts = conn.pointsToConnect
      const originalStart = { x: pts[0]!.x, y: pts[0]!.y }
      const originalEnd = { x: pts[pts.length - 1]!.x, y: pts[pts.length - 1]!.y }
      const startCandidates = this.getNudgeCandidates(originalStart, originalEnd, params.srj.obstacles, conn.name)
      const endCandidates = this.getNudgeCandidates(originalEnd, originalStart, params.srj.obstacles, conn.name)
      return {
        name: conn.name,
        originalStart,
        originalEnd,
        start: startCandidates[0] ?? originalStart,
        end: endCandidates[0] ?? originalEnd,
        startCandidates,
        endCandidates,
      }
    })

    this.remaining = [...this.allConnections]
    this.totalConnections = this.remaining.length
    this.MAX_ITERATIONS = Math.max(500, this.totalConnections * 10)
  }

  /** Layer names based on maxLayerCount (stable even as layerCount grows) */
  private getAllLayerNames(): string[] {
    const names: string[] = []
    for (let z = 0; z < this.maxLayerCount; z++) {
      if (z === 0) names.push("top")
      else if (z === this.maxLayerCount - 1) names.push("bottom")
      else names.push(`inner${z}`)
    }
    return names
  }

  private getLayerNames(): string[] {
    return this.getAllLayerNames().slice(0, this.layerCount)
  }

  /** Max total obstacle vertices before we skip mesh rebuild (OOM guard) */
  private static MAX_OBSTACLE_VERTICES = 50_000

  private buildMesh(layerZ: number) {
    // Merge overlapping rect obstacles (axis-aligned) to avoid CDT failures
    // from shared/overlapping edges. Trace polygon obstacles are NOT merged
    // since they may not be axis-aligned.
    const mergedRects = mergeOverlappingRects(this.rectObstacles[layerZ]!)
    const allObstacles = [
      ...mergedRects,
      ...this.tracePolygonObstacles[layerZ]!,
    ]

    // Guard: skip rebuild if obstacle complexity is too high
    const totalVerts = allObstacles.reduce((sum, poly) => sum + poly.length, 0)
    if (totalVerts > GreedySequentialPathSolver.MAX_OBSTACLE_VERTICES) {
      console.warn(`buildMesh: skipping layer ${layerZ} rebuild — ${totalVerts} vertices exceeds limit`)
      return
    }

    const cdtResult = cdtTriangulate({
      bounds: this.srj.bounds,
      obstacles: allObstacles,
    })
    if (!cdtResult) {
      console.warn(`buildMesh: CDT failed for layer ${layerZ}`)
      return
    }
    const rawMesh = buildMeshFromRegions(cdtResult)
    this.meshes[layerZ] = mergeMesh(rawMesh)
  }

  /**
   * If a point sits on/inside expanded obstacles that it's connected to,
   * nudge it outward so it clears all expanded boundaries. Uses the
   * direction toward the other endpoint to pick the escape side.
   * Lands slightly beyond the edge so Polyanya doesn't treat it as inside.
   */
  private nudgeOutOfObstacle(
    pt: { x: number; y: number },
    other: { x: number; y: number },
    obstacles: SimpleRouteJson["obstacles"],
    connName: string,
  ): Point {
    const ranked = this.getNudgeCandidates(pt, other, obstacles, connName)
    return ranked[0] ?? { x: pt.x, y: pt.y }
  }

  /**
   * Returns up to 4 nudge candidates ranked by alignment toward the other
   * endpoint, then by shortest escape distance. The first element is the
   * "best" direction; callers can try others if routing fails.
   */
  private getNudgeCandidates(
    pt: { x: number; y: number },
    other: { x: number; y: number },
    obstacles: SimpleRouteJson["obstacles"],
    connName: string,
  ): Point[] {
    const connected = obstacles.filter((obs) =>
      obs.connectedTo.includes(connName),
    )
    if (connected.length === 0) return [{ x: pt.x, y: pt.y }]

    // Find the innermost connected obstacle that contains the point
    let containingObs: (typeof connected)[0] | null = null
    for (const obs of connected) {
      const halfW = obs.width / 2 + this.margin + 0.05
      const halfH = obs.height / 2 + this.margin + 0.05
      if (
        Math.abs(pt.x - obs.center.x) < halfW &&
        Math.abs(pt.y - obs.center.y) < halfH
      ) {
        // Prefer smaller (more specific) obstacle
        if (!containingObs || obs.width * obs.height < containingObs.width * containingObs.height) {
          containingObs = obs
        }
      }
    }
    if (!containingObs) return [{ x: pt.x, y: pt.y }]

    const obs = containingObs
    const halfW = obs.width / 2 + this.margin + 0.05
    const halfH = obs.height / 2 + this.margin + 0.05
    const toOtherX = other.x - pt.x
    const toOtherY = other.y - pt.y
    const dx = pt.x - obs.center.x
    const dy = pt.y - obs.center.y

    const rawCandidates = [
      { x: obs.center.x + halfW, y: pt.y, score: toOtherX, dist: halfW - dx },
      { x: obs.center.x - halfW, y: pt.y, score: -toOtherX, dist: halfW + dx },
      { x: pt.x, y: obs.center.y + halfH, score: toOtherY, dist: halfH - dy },
      { x: pt.x, y: obs.center.y - halfH, score: -toOtherY, dist: halfH + dy },
    ]
    rawCandidates.sort((a, b) => {
      const aAligned = a.score > 0 ? 1 : 0
      const bAligned = b.score > 0 ? 1 : 0
      if (aAligned !== bAligned) return bAligned - aAligned
      return a.dist - b.dist
    })

    // For each raw candidate, iteratively push out of any remaining connected obstacles
    const results: Point[] = []
    for (const cand of rawCandidates) {
      let result = { x: cand.x, y: cand.y }
      for (let iter = 0; iter < 5; iter++) {
        let pushed = false
        for (const obs2 of connected) {
          const hw = obs2.width / 2 + this.margin + 0.05
          const hh = obs2.height / 2 + this.margin + 0.05
          const d2x = result.x - obs2.center.x
          const d2y = result.y - obs2.center.y
          if (Math.abs(d2x) < hw && Math.abs(d2y) < hh) {
            // Push same direction as the initial escape
            const distRight = hw - d2x
            const distLeft = hw + d2x
            const distTop = hh - d2y
            const distBottom = hh + d2y
            const minDist = Math.min(distRight, distLeft, distTop, distBottom)
            if (minDist === distRight) result = { x: obs2.center.x + hw, y: result.y }
            else if (minDist === distLeft) result = { x: obs2.center.x - hw, y: result.y }
            else if (minDist === distBottom) result = { x: result.x, y: obs2.center.y - hh }
            else result = { x: result.x, y: obs2.center.y + hh }
            pushed = true
          }
        }
        if (!pushed) break
      }
      results.push(result)
    }

    return results
  }

  /** Reset routing state back to initial (no committed traces) */
  private resetState() {
    this.rectObstacles = this.baseObstaclePolygons.slice(0, this.layerCount).map((polys) => [...polys])
    this.tracePolygonObstacles = Array.from({ length: this.layerCount }, () => [])
    this.traceWeightedRegions = Array.from({ length: this.layerCount }, () => [])
    this.meshes = Array.from({ length: this.layerCount }, () => null)
    this.resolvedPaths = []
    this.traceObstaclePolys = []
    this.remaining = [...this.allConnections]
    for (let z = 0; z < this.layerCount; z++) {
      this.buildMesh(z)
    }
  }

  /**
   * Convert a polyline path into weighted region polygons — many small squares
   * placed along each segment so diagonal segments get tight-fitting coverage.
   */
  private pathToWeightedRegions(
    path: Point[],
    clearance: number,
  ): WeightedRegion[] {
    const regions: WeightedRegion[] = []
    const side = clearance * 2

    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!
      const b = path[i + 1]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const segLen = Math.hypot(dx, dy)

      if (segLen < 1e-9) continue

      const steps = Math.max(1, Math.ceil(segLen / side))
      for (let s = 0; s <= steps; s++) {
        const t = s / steps
        const cx = a.x + dx * t
        const cy = a.y + dy * t
        regions.push({
          polygon: rectToPolygon(cx, cy, side, side, 0),
          weight: TRACE_WEIGHT,
          penalty: TRACE_PENALTY,
        })
      }
    }

    return regions
  }

  /**
   * Convert a polyline path into a single thick polygon obstacle by offsetting
   * each segment perpendicular to its direction. Produces a tight-fitting
   * outline that follows diagonal segments precisely, unlike axis-aligned rects.
   *
   * Returns an array with one polygon (or empty if path is degenerate).
   */
  private pathToObstaclePolygons(
    path: Point[],
    clearance: number,
    originalStart?: Point,
    originalEnd?: Point,
  ): Point[][] {
    if (path.length < 2) return []

    // Deduplicate consecutive coincident points
    const pts: Point[] = [path[0]!]
    for (let i = 1; i < path.length; i++) {
      const prev = pts[pts.length - 1]!
      const cur = path[i]!
      if (Math.abs(cur.x - prev.x) > 1e-9 || Math.abs(cur.y - prev.y) > 1e-9) {
        pts.push(cur)
      }
    }
    if (pts.length < 2) return []

    // Extend endpoints by clearance unless the original point is a shared junction
    if (originalStart) {
      const key = `${originalStart.x},${originalStart.y}`
      if (!this.sharedPoints.has(key)) {
        const first = pts[0]!
        const second = pts[1]!
        const dx = second.x - first.x
        const dy = second.y - first.y
        const len = Math.hypot(dx, dy)
        if (len > 1e-9) {
          pts[0] = { x: first.x - (dx / len) * clearance, y: first.y - (dy / len) * clearance }
        }
      }
    }
    if (originalEnd) {
      const key = `${originalEnd.x},${originalEnd.y}`
      if (!this.sharedPoints.has(key)) {
        const last = pts[pts.length - 1]!
        const secondToLast = pts[pts.length - 2]!
        const dx = last.x - secondToLast.x
        const dy = last.y - secondToLast.y
        const len = Math.hypot(dx, dy)
        if (len > 1e-9) {
          pts[pts.length - 1] = { x: last.x + (dx / len) * clearance, y: last.y + (dy / len) * clearance }
        }
      }
    }

    // Compute per-segment unit normals (pointing left when walking A→B)
    const normals: { nx: number; ny: number }[] = []
    for (let i = 0; i < pts.length - 1; i++) {
      const dx = pts[i + 1]!.x - pts[i]!.x
      const dy = pts[i + 1]!.y - pts[i]!.y
      const len = Math.hypot(dx, dy)
      // Normal rotated 90° CCW: (-dy, dx)
      normals.push({ nx: -dy / len, ny: dx / len })
    }

    // Build left side (forward along path, offset +clearance in normal dir)
    // and right side (offset -clearance). At interior vertices, use a bevel
    // join on the outside of each turn so the polygon covers full corners.
    //
    // Turn direction is determined by cross product of adjacent segment dirs:
    //   cross > 0 → left turn → outside is right side → bevel right
    //   cross < 0 → right turn → outside is left side → bevel left
    // The inside gets a single miter point; the outside gets two points
    // (one per adjacent segment normal) to form a bevel.
    const left: Point[] = []
    const right: Point[] = []

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!

      if (i === 0) {
        const n = normals[0]!
        left.push({ x: p.x + n.nx * clearance, y: p.y + n.ny * clearance })
        right.push({ x: p.x - n.nx * clearance, y: p.y - n.ny * clearance })
      } else if (i === pts.length - 1) {
        const n = normals[normals.length - 1]!
        left.push({ x: p.x + n.nx * clearance, y: p.y + n.ny * clearance })
        right.push({ x: p.x - n.nx * clearance, y: p.y - n.ny * clearance })
      } else {
        const n0 = normals[i - 1]!
        const n1 = normals[i]!

        // Cross product of segment directions to determine turn direction
        // d0 direction: (pts[i] - pts[i-1]), d1 direction: (pts[i+1] - pts[i])
        const d0x = pts[i]!.x - pts[i - 1]!.x
        const d0y = pts[i]!.y - pts[i - 1]!.y
        const d1x = pts[i + 1]!.x - pts[i]!.x
        const d1y = pts[i + 1]!.y - pts[i]!.y
        const cross = d0x * d1y - d0y * d1x

        // Miter normal for the inside
        let mx = n0.nx + n1.nx
        let my = n0.ny + n1.ny
        const mlen = Math.hypot(mx, my)
        if (mlen > 1e-9) {
          const dot = n0.nx * n1.nx + n0.ny * n1.ny
          const cosHalf = Math.sqrt((1 + dot) / 2)
          const scale = cosHalf > 0.3 ? 1 / cosHalf : 1 / 0.3
          mx = (mx / mlen) * scale
          my = (my / mlen) * scale
        } else {
          mx = n0.nx
          my = n0.ny
        }

        if (cross > 1e-9) {
          // Left turn: inside is left, outside is right → bevel on right
          left.push({ x: p.x + mx * clearance, y: p.y + my * clearance })
          right.push({ x: p.x - n0.nx * clearance, y: p.y - n0.ny * clearance })
          right.push({ x: p.x - n1.nx * clearance, y: p.y - n1.ny * clearance })
        } else if (cross < -1e-9) {
          // Right turn: inside is right, outside is left → bevel on left
          left.push({ x: p.x + n0.nx * clearance, y: p.y + n0.ny * clearance })
          left.push({ x: p.x + n1.nx * clearance, y: p.y + n1.ny * clearance })
          right.push({ x: p.x - mx * clearance, y: p.y - my * clearance })
        } else {
          // Straight (or nearly): single miter point on each side
          left.push({ x: p.x + mx * clearance, y: p.y + my * clearance })
          right.push({ x: p.x - mx * clearance, y: p.y - my * clearance })
        }
      }
    }

    // Form closed polygon: left side forward, then right side reversed
    const polygon: Point[] = [...left, ...right.reverse()]

    return [polygon]
  }

  /**
   * Create via obstacle polygons at a point (circle approximated as expanded rect).
   * Vias block both layers so they get added to all layer meshes.
   */
  private viaToObstaclePolygon(viaPoint: Point): Point[] {
    const r = this.viaDiameter / 2
    return rectToPolygon(viaPoint.x, viaPoint.y, r * 2, r * 2, this.margin)
  }

  /** Search using Polyanya SearchInstance (mesh-based, no weighted regions) */
  private searchPolyanya(
    mesh: Mesh,
    start: Point,
    end: Point,
  ): { cost: number; path: Point[] } {
    const si = new SearchInstance(mesh)
    si.setStartGoal(start, end)
    const found = si.search()
    if (!found) return { cost: -1, path: [] }
    return { cost: si.getCost(), path: si.getPathPoints() }
  }

  /** Search using VisibilityGraph (supports weighted regions) */
  private searchVG(
    mesh: Mesh,
    layerZ: number,
    start: Point,
    end: Point,
  ): { cost: number; path: Point[] } {
    const vg = new VisibilityGraph(mesh, {
      weightedRegions: this.useObstacles ? [] : this.traceWeightedRegions[layerZ]!,
    })
    const r = vg.search(start, end)
    return { cost: r.cost, path: r.path }
  }

  /**
   * Pick the best connection to route on a specific layer.
   * Returns index into remaining, or -1 if nothing is routable.
   */
  private pickBestOnLayer(
    layerZ: number,
    pickShortest: boolean,
  ): { idx: number; path: Point[] } {
    const mesh = this.meshes[layerZ]
    if (!mesh) return { idx: -1, path: [] }

    let bestIdx = -1
    let bestCost = pickShortest ? Infinity : -Infinity
    let bestPath: Point[] = []

    // Track which start/end combo was best for the winning connection
    let bestStart: Point | null = null
    let bestEnd: Point | null = null

    for (let i = 0; i < this.remaining.length; i++) {
      const c = this.remaining[i]!

      // Try the default nudge first, then alternate directions
      const starts = c.startCandidates.length > 0 ? c.startCandidates : [c.start]
      const ends = c.endCandidates.length > 0 ? c.endCandidates : [c.end]

      let foundForThis = false
      for (const s of starts) {
        for (const e of ends) {
          const r = this.usePolyanya
            ? this.searchPolyanya(mesh, s, e)
            : this.searchVG(mesh, layerZ, s, e)
          if (r.cost < 0 || r.path.length === 0) continue

          const better = pickShortest
            ? r.cost < bestCost
            : r.cost > bestCost
          if (better) {
            bestIdx = i
            bestCost = r.cost
            bestPath = r.path
            bestStart = s
            bestEnd = e
          }
          foundForThis = true
          break
        }
        if (foundForThis) break
      }
    }

    // Update the winning connection's active start/end
    if (bestIdx >= 0 && bestStart && bestEnd) {
      this.remaining[bestIdx]!.start = bestStart
      this.remaining[bestIdx]!.end = bestEnd
    }

    return { idx: bestIdx, path: bestPath }
  }

  /**
   * Try to pick a connection across all layers, preferring layer 0.
   * Returns the best match with its layer, or idx=-1 if nothing routable.
   */
  private pickBestAcrossLayers(
    pickShortest: boolean,
  ): { idx: number; path: Point[]; layerZ: number } {
    // Try layer 0 first (primary layer)
    const layer0 = this.pickBestOnLayer(0, pickShortest)
    if (layer0.idx >= 0) {
      return { ...layer0, layerZ: 0 }
    }

    // Fall back to other layers
    for (let z = 1; z < this.layerCount; z++) {
      const result = this.pickBestOnLayer(z, pickShortest)
      if (result.idx >= 0) {
        return { ...result, layerZ: z }
      }
    }

    return { idx: -1, path: [], layerZ: 0 }
  }

  /** Commit a routed path on a specific layer: add to results and update obstacles/regions */
  private commitPath(
    conn: { name: string; originalStart: Point; originalEnd: Point },
    path: Point[],
    layerZ: number,
  ) {
    const fullRoute: { x: number; y: number; z: number }[] = []
    const vias: { x: number; y: number }[] = []

    const routeStart = path[0]!
    const routeEnd = path[path.length - 1]!

    if (layerZ === 0) {
      // Same layer — just bridge original points
      if (
        Math.abs(conn.originalStart.x - routeStart.x) > 1e-6 ||
        Math.abs(conn.originalStart.y - routeStart.y) > 1e-6
      ) {
        fullRoute.push({ x: conn.originalStart.x, y: conn.originalStart.y, z: 0 })
      }

      for (const p of path) {
        fullRoute.push({ x: p.x, y: p.y, z: 0 })
      }

      if (
        Math.abs(conn.originalEnd.x - routeEnd.x) > 1e-6 ||
        Math.abs(conn.originalEnd.y - routeEnd.y) > 1e-6
      ) {
        fullRoute.push({ x: conn.originalEnd.x, y: conn.originalEnd.y, z: 0 })
      }
    } else {
      // Different layer — need vias at start and end to transition

      // Bridge from original start on layer 0
      fullRoute.push({ x: conn.originalStart.x, y: conn.originalStart.y, z: 0 })

      // Via down at the nudged start point
      const viaStart = { x: routeStart.x, y: routeStart.y }
      fullRoute.push({ x: viaStart.x, y: viaStart.y, z: 0 })
      vias.push(viaStart)
      // Now on layerZ
      fullRoute.push({ x: viaStart.x, y: viaStart.y, z: layerZ })

      // Route on layerZ (skip first point, already added as via location)
      for (let i = 1; i < path.length - 1; i++) {
        fullRoute.push({ x: path[i]!.x, y: path[i]!.y, z: layerZ })
      }

      // Via up at the nudged end point
      const viaEnd = { x: routeEnd.x, y: routeEnd.y }
      fullRoute.push({ x: viaEnd.x, y: viaEnd.y, z: layerZ })
      vias.push(viaEnd)
      // Back on layer 0
      fullRoute.push({ x: viaEnd.x, y: viaEnd.y, z: 0 })

      // Bridge to original end on layer 0
      if (
        Math.abs(conn.originalEnd.x - viaEnd.x) > 1e-6 ||
        Math.abs(conn.originalEnd.y - viaEnd.y) > 1e-6
      ) {
        fullRoute.push({ x: conn.originalEnd.x, y: conn.originalEnd.y, z: 0 })
      }
    }

    this.resolvedPaths.push({
      connectionName: conn.name,
      route: fullRoute,
      vias,
    })

    // Trace-to-trace clearance: half-width of this trace + half-width of
    // the next trace that needs to pass alongside. Using margin here would
    // be too generous and block adjacent routes unnecessarily.
    const clearance = this.minTraceWidth / 2 + this.margin

    if (this.useObstacles) {
      // Add trace thick polygon obstacle to the layer the trace was routed on
      const newObstacles = this.pathToObstaclePolygons(path, clearance, conn.originalStart, conn.originalEnd)
      this.tracePolygonObstacles[layerZ]!.push(...newObstacles)

      for (const poly of newObstacles) {
        this.traceObstaclePolys.push({
          polygon: poly,
          connectionName: conn.name,
          layerZ,
        })
      }

      // Add via obstacles to ALL layers (vias are through-hole)
      if (vias.length > 0) {
        for (let z = 0; z < this.layerCount; z++) {
          for (const via of vias) {
            const viaPoly = this.viaToObstaclePolygon(via)
            this.rectObstacles[z]!.push(viaPoly)
          }
        }
      }

      // Rebuild meshes for affected layers
      this.buildMesh(layerZ)
      if (vias.length > 0) {
        for (let z = 0; z < this.layerCount; z++) {
          if (z !== layerZ) this.buildMesh(z)
        }
      }
    } else {
      const newRegions = this.pathToWeightedRegions(path, clearance)
      this.traceWeightedRegions[layerZ]!.push(...newRegions)

      for (const wr of newRegions) {
        this.traceObstaclePolys.push({
          polygon: wr.polygon,
          connectionName: conn.name,
          layerZ,
        })
      }
    }
  }

  /** Save current results if they're the best so far */
  private saveIfBest() {
    if (
      !this.bestResults ||
      this.resolvedPaths.length > this.bestResults.length
    ) {
      this.bestResults = this.resolvedPaths
      this.bestObstaclePolys = this.traceObstaclePolys
    }
  }

  /** Add a new layer (base obstacle polygons already computed in constructor) */
  private addLayer() {
    this.layerCount++
  }

  /** Advance to the next phase after current phase gets stuck */
  private advancePhase() {
    this.saveIfBest()

    if (this.phase === "shortest") {
      this.resetState()
      this.phase = "longest"
      return
    }

    if (this.phase === "longest") {
      // Try adding a layer if allowed
      if (this.layerCount < this.maxLayerCount) {
        this.addLayer()
        this.resetState()
        this.phase = "shortest"
        return
      }
    }

    // All phases and layers exhausted — use best result
    if (this.bestResults) {
      this.resolvedPaths = this.bestResults
      this.traceObstaclePolys = this.bestObstaclePolys!
    }
    this.phase = "done"
    this.solved = true
  }

  _step() {
    if (this.phase === "done") {
      this.solved = true
      return
    }

    // Initialize timer on first step
    if (this.solveStartTime === 0) this.solveStartTime = Date.now()

    // Timeout guard: bail if solving takes too long
    if (Date.now() - this.solveStartTime > GreedySequentialPathSolver.MAX_SOLVE_TIME_MS) {
      console.warn(`GreedySequentialPathSolver: timeout after ${GreedySequentialPathSolver.MAX_SOLVE_TIME_MS}ms, ${this.resolvedPaths.length}/${this.totalConnections} routed`)
      this.saveIfBest()
      if (this.bestResults) {
        this.resolvedPaths = this.bestResults
        this.traceObstaclePolys = this.bestObstaclePolys!
      }
      this.phase = "done"
      this.solved = true
      return
    }

    if (this.remaining.length === 0) {
      this.saveIfBest()
      this.phase = "done"
      this.solved = true
      return
    }

    const pickShortest = this.phase === "shortest"
    const { idx, path, layerZ } = this.pickBestAcrossLayers(pickShortest)

    if (idx < 0) {
      // Stuck — advance to next phase
      this.advancePhase()
      return
    }

    const conn = this.remaining[idx]!
    this.remaining.splice(idx, 1)
    this.commitPath(conn, path, layerZ)

    this.progress =
      (this.totalConnections - this.remaining.length) / this.totalConnections
  }

  getResolvedPaths(): ResolvedPath[] {
    return this.resolvedPaths
  }

  /** Connection names that couldn't be routed */
  getUnroutedConnectionNames(): string[] {
    return this.remaining.map((c) => c.name)
  }

  getEffectiveLayerCount(): number {
    return this.layerCount
  }

  visualize(): GraphicsObject & { polygons?: Array<{ points: { x: number; y: number }[]; fill?: string; stroke?: string; strokeWidth?: number }> } {
    const lines: Line[] = []
    const points: GraphicsObject["points"] = []
    const polygons: Array<{ points: { x: number; y: number }[]; fill?: string; stroke?: string; strokeWidth?: number }> = []

    // Draw committed trace paths, split by layer for distinct styling
    for (const rp of this.resolvedPaths) {
      const color = this.colorMap[rp.connectionName] ?? "green"
      // Group consecutive points by z-layer
      let segStart = 0
      for (let i = 1; i <= rp.route.length; i++) {
        const prevZ = rp.route[i - 1]!.z
        const curZ = i < rp.route.length ? rp.route[i]!.z : -999
        if (curZ !== prevZ || i === rp.route.length) {
          const segment = rp.route.slice(segStart, i)
          if (segment.length >= 2) {
            const isTop = prevZ === 0
            lines.push({
              points: segment.map((p) => ({ x: p.x, y: p.y })),
              strokeColor: isTop ? color : `${color}99`,
              strokeWidth: this.minTraceWidth,
              ...(isTop ? {} : { strokeDash: "4 2" }),
            })
          }
          segStart = i
        }
      }
    }

    // Draw trace obstacle polygons as filled shapes
    for (const tp of this.traceObstaclePolys) {
      const color = this.colorMap[tp.connectionName] ?? "green"
      const fillOpacity = tp.layerZ === 0 ? "20" : "10"
      const strokeOpacity = tp.layerZ === 0 ? "60" : "30"
      if (tp.polygon.length >= 3) {
        polygons.push({
          points: tp.polygon.map((p) => ({ x: p.x, y: p.y })),
          fill: `${color}${fillOpacity}`,
          stroke: `${color}${strokeOpacity}`,
          strokeWidth: 0.02,
        })
      }
    }

    // Draw mesh edges (layer 0 only for clarity)
    const mesh = this.meshes[0]
    if (mesh) {
      for (const polygon of mesh.polygons) {
        if (polygon.vertices.length < 2) continue
        const pts: { x: number; y: number }[] = []
        for (const vIdx of polygon.vertices) {
          const v = mesh.vertices[vIdx]
          if (v) pts.push({ x: v.p.x, y: v.p.y })
        }
        if (pts.length > 0) pts.push({ ...pts[0]! })
        lines.push({
          points: pts,
          strokeColor: "rgba(100,100,255,0.4)",
          strokeWidth: 0.03,
        })
      }
    }

    // Draw via markers
    for (const rp of this.resolvedPaths) {
      for (const via of rp.vias) {
        const color = this.colorMap[rp.connectionName] ?? "green"
        points.push({
          x: via.x,
          y: via.y,
          color,
          label: `via`,
        })
      }
    }

    // Mark remaining unrouted endpoints
    for (const conn of this.remaining) {
      const color = this.colorMap[conn.name] ?? "red"
      points.push({ x: conn.start.x, y: conn.start.y, color, label: `${conn.name} (unrouted)` })
      points.push({ x: conn.end.x, y: conn.end.y, color })
    }

    return { lines, points, polygons }
  }
}
