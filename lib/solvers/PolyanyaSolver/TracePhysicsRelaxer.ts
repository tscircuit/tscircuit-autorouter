import type { ResolvedPath } from "./types"

/** Axis-aligned box obstacle (already expanded by margin) passed to the relaxer. */
export interface RelaxerObstacle {
  /** Layer z-indices this obstacle occupies (empty = all layers) */
  layers: number[]
  cx: number
  cy: number
  /** Half-width (already includes margin expansion) */
  hw: number
  /** Half-height (already includes margin expansion) */
  hh: number
}

/** Closest-point pair between two line segments.
 *  Returns parametric positions s∈[0,1] on AB, t∈[0,1] on CD,
 *  the squared distance, and the unit normal pointing from CD→AB. */
function segSegClosest(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): { dist: number; nx: number; ny: number; s: number; t: number } {
  const d1x = bx - ax
  const d1y = by - ay
  const d2x = dx - cx
  const d2y = dy - cy
  const rx = ax - cx
  const ry = ay - cy

  const a = d1x * d1x + d1y * d1y
  const e = d2x * d2x + d2y * d2y
  const f = d2x * rx + d2y * ry

  let s: number
  let t: number

  if (a < 1e-12 && e < 1e-12) {
    s = 0
    t = 0
  } else if (a < 1e-12) {
    s = 0
    t = Math.max(0, Math.min(1, f / e))
  } else {
    const c = d1x * rx + d1y * ry
    if (e < 1e-12) {
      t = 0
      s = Math.max(0, Math.min(1, -c / a))
    } else {
      const b = d1x * d2x + d1y * d2y
      const denom = a * e - b * b
      s = denom > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0
      t = (b * s + f) / e
      if (t < 0) {
        t = 0
        s = Math.max(0, Math.min(1, -c / a))
      } else if (t > 1) {
        t = 1
        s = Math.max(0, Math.min(1, (b - c) / a))
      }
    }
  }

  // Closest point on AB
  const p1x = ax + d1x * s
  const p1y = ay + d1y * s
  // Closest point on CD
  const p2x = cx + d2x * t
  const p2y = cy + d2y * t

  const dx2 = p1x - p2x
  const dy2 = p1y - p2y
  const dist = Math.hypot(dx2, dy2)
  // Normal points from CD toward AB (push AB away from CD in +n dir)
  const nx = dist > 1e-9 ? dx2 / dist : 1
  const ny = dist > 1e-9 ? dy2 / dist : 0

  return { dist, nx, ny, s, t }
}

/**
 * Closest point on or inside an AABB to point (px, py).
 * Returns the separation vector (from closest point toward the external point)
 * and the penetration depth (positive = point is outside, negative = inside).
 * When the point is inside the box we push it out via the nearest face.
 */
function pointAABBSeparation(
  px: number,
  py: number,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
): { nx: number; ny: number; depth: number } | null {
  const dx = px - cx
  const dy = py - cy
  const overlapX = hw - Math.abs(dx)
  const overlapY = hh - Math.abs(dy)

  if (overlapX <= 0 || overlapY <= 0) {
    // Point is outside the AABB — compute distance to nearest edge
    const clampedX = Math.max(-hw, Math.min(hw, dx))
    const clampedY = Math.max(-hh, Math.min(hh, dy))
    const nearX = cx + clampedX
    const nearY = cy + clampedY
    const sepX = px - nearX
    const sepY = py - nearY
    const dist = Math.hypot(sepX, sepY)
    if (dist < 1e-9) return null
    return { nx: sepX / dist, ny: sepY / dist, depth: -dist } // negative = outside
  }

  // Point is inside the AABB — push out via nearest face
  if (overlapX < overlapY) {
    const nx = dx >= 0 ? 1 : -1
    return { nx, ny: 0, depth: overlapX }
  } else {
    const ny = dy >= 0 ? 1 : -1
    return { nx: 0, ny, depth: overlapY }
  }
}

/**
 * Closest distance from segment AB to an AABB obstacle.
 * Returns the separation data for the point on the segment closest to the AABB,
 * and the parametric position `t` on AB where that closest point lies.
 */
function segAABBClosest(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
): { nx: number; ny: number; depth: number; t: number } | null {
  // Sample the segment at a few points to find the closest to the AABB.
  // For short segments (typical trace steps) 5 samples is more than enough.
  const SAMPLES = 5
  let bestDepth = -Infinity
  let bestNx = 0
  let bestNy = 0
  let bestT = 0

  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES
    const px = ax + (bx - ax) * t
    const py = ay + (by - ay) * t
    const sep = pointAABBSeparation(px, py, cx, cy, hw, hh)
    if (!sep) continue
    if (sep.depth > bestDepth) {
      bestDepth = sep.depth
      bestNx = sep.nx
      bestNy = sep.ny
      bestT = t
    }
  }

  if (bestDepth === -Infinity) return null
  return { nx: bestNx, ny: bestNy, depth: bestDepth, t: bestT }
}

interface BinSeg {
  traceIdx: number
  /** index into trace route array for start vertex */
  vi: number
  /** index into trace route array for end vertex */
  vj: number
  netName: string
  ax: number
  ay: number
  az: number
  bx: number
  by: number
  aFixed: boolean
  bFixed: boolean
}

/**
 * Physics-based trace relaxation.
 *
 * Each call to relax() runs `iterations` Jacobi steps:
 *   1. Build a spatial bin structure over all trace segments (cell = 2*clearance)
 *   2. For each pair of segments from different nets in the same/adjacent cells,
 *      compute a separation impulse proportional to the clearance violation depth.
 *      Impulses are distributed to the two endpoint vertices of each segment
 *      weighted by the parametric closest-point position (so the force is applied
 *      where the segments are actually touching).
 *   3. Interior vertices also receive a light string-pull impulse toward the
 *      midpoint of their two neighbours, shortening the trace.
 *   4. All accumulated impulses are applied simultaneously (Jacobi — not Gauss-Seidel),
 *      so no single segment "wins" at the expense of another.
 *
 * After all iterations the updated positions are written back to resolvedPaths.
 * Returns true if any vertex moved (caller should then rebuild CDT obstacles).
 *
 * ## Inflation / separation factor
 *
 * The `separationFactor` constructor parameter controls how far apart traces
 * are pushed relative to the trace clearance radius:
 *
 *   target gap between trace centerlines = traceClearance × separationFactor
 *
 * Each committed trace occupies `traceClearance` on each side in the CDT
 * obstacle map, so the free corridor left between two relaxed traces is:
 *
 *   corridor width = traceClearance × (separationFactor − 2)
 *
 * A value of 2.0 leaves a zero-width corridor (traces just touching in the
 * CDT).  A value of 3.0 leaves a full-clearance corridor — exactly enough
 * room for one more trace to burrow between them.  The default of 2.5 is a
 * good middle ground: traces don't balloon apart on sparse boards, yet a
 * half-clearance slot opens up that the pathfinder can exploit.
 */
export class TracePhysicsRelaxer {
  /** Target separation between trace centerlines (= traceClearance * separationFactor) */
  private clearance: number
  /** Spatial grid cell size = 2*clearance so any pair within clearance share a cell */
  private cellSize: number

  /**
   * @param traceClearance  The obstacle polygon clearance used by the solver
   *                        (= minTraceWidth/2 + margin).
   * @param separationFactor  How many clearance-widths apart to push traces.
   *                          Must be > 2 to leave any routing corridor between
   *                          them.  Default 2.5 leaves a half-clearance slot.
   */
  constructor(traceClearance: number, separationFactor = 2.5) {
    this.clearance = traceClearance * separationFactor
    this.cellSize = this.clearance * 2
  }

  // -----------------------------------------------------------------------
  // Spatial bin helpers
  // -----------------------------------------------------------------------

  private cellKey(cx: number, cy: number): string {
    return `${cx},${cy}`
  }

  /** Hash a segment (inflated by clearance) into all overlapping grid cells. */
  private hashSegment(seg: BinSeg, bins: Map<string, BinSeg[]>) {
    const cs = this.cellSize
    const minCx = Math.floor((Math.min(seg.ax, seg.bx) - this.clearance) / cs)
    const maxCx = Math.floor((Math.max(seg.ax, seg.bx) + this.clearance) / cs)
    const minCy = Math.floor((Math.min(seg.ay, seg.by) - this.clearance) / cs)
    const maxCy = Math.floor((Math.max(seg.ay, seg.by) + this.clearance) / cs)

    for (let gx = minCx; gx <= maxCx; gx++) {
      for (let gy = minCy; gy <= maxCy; gy++) {
        const key = this.cellKey(gx, gy)
        let list = bins.get(key)
        if (!list) {
          list = []
          bins.set(key, list)
        }
        list.push(seg)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Main relax method
  // -----------------------------------------------------------------------

  /**
   * @param resolvedPaths   Live route data (modified in-place on movement).
   * @param fixedKeys       Set of "x,y" strings for pad positions that must not move.
   * @param netNameFn       Maps connection name → net name for same-net exemption.
   * @param iterations      Jacobi iteration count (typically 3-10).
   * @param stringPull      Spring-pull strength toward chord midpoint (0=off, 0.1=light).
   * @param obstacles       Fixed AABB obstacles (component pads, board edges) that
   *                        trace vertices must be pushed away from.  These are treated
   *                        with the same priority as trace-trace collisions — there is
   *                        no hierarchy; obstacle avoidance and trace separation forces
   *                        are all summed in the same Jacobi accumulator.
   */
  relax(
    resolvedPaths: ResolvedPath[],
    fixedKeys: Set<string>,
    netNameFn: (name: string) => string,
    iterations = 5,
    stringPull = 0.08,
    obstacles: RelaxerObstacle[] = [],
  ): boolean {
    // Need at least 2 traces for trace-vs-trace, or at least 1 for obstacle avoidance
    if (resolvedPaths.length === 0) return false
    if (resolvedPaths.length < 2 && obstacles.length === 0) return false

    // -----------------------------------------------------------------------
    // Build mutable vertex arrays (decoupled from resolvedPaths during iteration)
    // -----------------------------------------------------------------------
    const allVerts: { x: number; y: number; z: number; fixed: boolean }[][] =
      resolvedPaths.map((rp) =>
        rp.route.map((p) => ({
          x: p.x,
          y: p.y,
          z: p.z,
          fixed:
            fixedKeys.has(`${p.x},${p.y}`) ||
            // Always fix the very first and last vertices (pad attachment points)
            false,
        })),
      )

    // Mark first and last vertex of each trace as fixed
    for (const verts of allVerts) {
      if (verts.length > 0) {
        verts[0]!.fixed = true
        verts[verts.length - 1]!.fixed = true
      }
    }

    // Pre-compute net names
    const netNames = resolvedPaths.map((rp) => netNameFn(rp.connectionName))

    let anyMoved = false

    for (let iter = 0; iter < iterations; iter++) {
      // -----------------------------------------------------------------------
      // Build segment list + spatial bins
      // -----------------------------------------------------------------------
      const segments: BinSeg[] = []
      for (let ti = 0; ti < allVerts.length; ti++) {
        const verts = allVerts[ti]!
        const netName = netNames[ti]!
        for (let vi = 0; vi < verts.length - 1; vi++) {
          const va = verts[vi]!
          const vb = verts[vi + 1]!
          if (va.z !== vb.z) continue // skip via-transition edges (layer change)
          segments.push({
            traceIdx: ti,
            vi,
            vj: vi + 1,
            netName,
            ax: va.x,
            ay: va.y,
            az: va.z,
            bx: vb.x,
            by: vb.y,
            aFixed: va.fixed,
            bFixed: vb.fixed,
          })
        }
      }

      const bins = new Map<string, BinSeg[]>()
      for (const seg of segments) this.hashSegment(seg, bins)

      // -----------------------------------------------------------------------
      // Accumulate impulses (Jacobi — compute all, apply once)
      // -----------------------------------------------------------------------
      const impulses: { dx: number; dy: number }[][] = allVerts.map((verts) =>
        verts.map(() => ({ dx: 0, dy: 0 })),
      )

      const processedPairs = new Set<string>()

      for (const [, cellSegs] of bins) {
        for (let i = 0; i < cellSegs.length; i++) {
          const sa = cellSegs[i]!
          for (let j = i + 1; j < cellSegs.length; j++) {
            const sb = cellSegs[j]!

            // Skip same trace or same net
            if (sa.traceIdx === sb.traceIdx) continue
            if (sa.netName === sb.netName) continue
            // Must be on the same layer
            if (sa.az !== sb.az) continue

            // Deduplicate (same pair can appear in multiple bins)
            const lo = sa.traceIdx < sb.traceIdx ? sa : sb
            const hi = sa.traceIdx < sb.traceIdx ? sb : sa
            const pairKey = `${lo.traceIdx}:${lo.vi}-${hi.traceIdx}:${hi.vi}`
            if (processedPairs.has(pairKey)) continue
            processedPairs.add(pairKey)

            const closest = segSegClosest(
              sa.ax,
              sa.ay,
              sa.bx,
              sa.by,
              sb.ax,
              sb.ay,
              sb.bx,
              sb.by,
            )

            if (closest.dist >= this.clearance) continue

            const depth = this.clearance - closest.dist
            // Half the penetration each; if one side is fully fixed the
            // other gets the full push (handled naturally since fixed
            // vertices just don't receive their half).
            const push = depth * 0.5

            // Distribute impulse to endpoints weighted by parametric position:
            // closest point on AB is at s, so vertex A gets (1-s) and B gets s.
            const saWa = 1 - closest.s
            const saWb = closest.s
            const sbWa = 1 - closest.t
            const sbWb = closest.t

            // nx,ny points from sb toward sa — push sa in +n, sb in -n
            const nx = closest.nx
            const ny = closest.ny

            if (!sa.aFixed) {
              impulses[sa.traceIdx]![sa.vi]!.dx += nx * push * saWa
              impulses[sa.traceIdx]![sa.vi]!.dy += ny * push * saWa
            }
            if (!sa.bFixed) {
              impulses[sa.traceIdx]![sa.vj]!.dx += nx * push * saWb
              impulses[sa.traceIdx]![sa.vj]!.dy += ny * push * saWb
            }
            if (!sb.aFixed) {
              impulses[sb.traceIdx]![sb.vi]!.dx -= nx * push * sbWa
              impulses[sb.traceIdx]![sb.vi]!.dy -= ny * push * sbWa
            }
            if (!sb.bFixed) {
              impulses[sb.traceIdx]![sb.vj]!.dx -= nx * push * sbWb
              impulses[sb.traceIdx]![sb.vj]!.dy -= ny * push * sbWb
            }
          }
        }
      }

      // -----------------------------------------------------------------------
      // String-pull: pull interior vertices toward chord midpoint
      // -----------------------------------------------------------------------
      if (stringPull > 0) {
        for (let ti = 0; ti < allVerts.length; ti++) {
          const verts = allVerts[ti]!
          for (let vi = 1; vi < verts.length - 1; vi++) {
            const v = verts[vi]!
            if (v.fixed) continue
            const prev = verts[vi - 1]!
            const next = verts[vi + 1]!
            // Only pull within the same layer (don't straighten across via transitions)
            if (prev.z !== v.z || next.z !== v.z) continue
            const midX = (prev.x + next.x) * 0.5
            const midY = (prev.y + next.y) * 0.5
            impulses[ti]![vi]!.dx += (midX - v.x) * stringPull
            impulses[ti]![vi]!.dy += (midY - v.y) * stringPull
          }
        }
      }

      // -----------------------------------------------------------------------
      // Obstacle repulsion: push trace vertices away from fixed AABB obstacles
      // with the same priority as trace-trace separation.
      // -----------------------------------------------------------------------
      if (obstacles.length > 0) {
        for (const seg of segments) {
          for (const obs of obstacles) {
            // Layer check: skip if obstacle doesn't affect this segment's layer
            if (obs.layers.length > 0 && !obs.layers.includes(seg.az)) continue

            const sep = segAABBClosest(
              seg.ax,
              seg.ay,
              seg.bx,
              seg.by,
              obs.cx,
              obs.cy,
              obs.hw,
              obs.hh,
            )
            if (!sep) continue

            // depth > 0 means the segment point is inside the box (hard violation)
            // depth < 0 means it's outside; we only repel within clearance distance
            const dist = -sep.depth // positive = outside, negative = inside
            if (dist >= this.clearance) continue

            const penetration = this.clearance - dist
            const push = penetration * 0.5

            // Distribute impulse to both vertices weighted by parametric position
            const wa = 1 - sep.t
            const wb = sep.t
            const nx = sep.nx
            const ny = sep.ny

            if (!seg.aFixed) {
              impulses[seg.traceIdx]![seg.vi]!.dx += nx * push * wa
              impulses[seg.traceIdx]![seg.vi]!.dy += ny * push * wa
            }
            if (!seg.bFixed) {
              impulses[seg.traceIdx]![seg.vj]!.dx += nx * push * wb
              impulses[seg.traceIdx]![seg.vj]!.dy += ny * push * wb
            }
          }
        }
      }

      // -----------------------------------------------------------------------
      // Apply all impulses simultaneously (Jacobi)
      // -----------------------------------------------------------------------
      let movedThisIter = false
      const MIN_MOVE = 1e-5
      for (let ti = 0; ti < allVerts.length; ti++) {
        const verts = allVerts[ti]!
        for (let vi = 0; vi < verts.length; vi++) {
          const v = verts[vi]!
          if (v.fixed) continue
          const imp = impulses[ti]![vi]!
          if (Math.abs(imp.dx) > MIN_MOVE || Math.abs(imp.dy) > MIN_MOVE) {
            v.x += imp.dx
            v.y += imp.dy
            movedThisIter = true
          }
        }
      }

      if (!movedThisIter) break
      anyMoved = true

      // Refresh segment coordinates for next iteration from updated vertices
      // (we need to update our local seg ax/ay etc — but since segments are
      // rebuilt at the top of each iter loop, this is handled automatically)
    }

    // -----------------------------------------------------------------------
    // Write updated positions back to resolvedPaths
    // -----------------------------------------------------------------------
    if (anyMoved) {
      for (let ti = 0; ti < resolvedPaths.length; ti++) {
        const rp = resolvedPaths[ti]!
        const verts = allVerts[ti]!
        for (let vi = 0; vi < rp.route.length; vi++) {
          rp.route[vi]!.x = verts[vi]!.x
          rp.route[vi]!.y = verts[vi]!.y
        }
      }
    }

    return anyMoved
  }
}
