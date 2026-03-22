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

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Closest-point pair between two 2-D line segments.
 *  s ∈ [0,1] on AB, t ∈ [0,1] on CD.
 *  nx,ny: unit normal pointing from CD toward AB (push AB in +n, CD in -n). */
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

  const p1x = ax + d1x * s
  const p1y = ay + d1y * s
  const p2x = cx + d2x * t
  const p2y = cy + d2y * t
  const ex = p1x - p2x
  const ey = p1y - p2y
  const dist = Math.hypot(ex, ey)
  return {
    dist,
    nx: dist > 1e-9 ? ex / dist : 1,
    ny: dist > 1e-9 ? ey / dist : 0,
    s,
    t,
  }
}

/**
 * Closest point on AABB boundary to (px,py).
 * depth > 0: point is INSIDE the box (penetration depth along nearest axis).
 * depth < 0: point is outside (negative = distance to nearest edge).
 * nx,ny: direction that moves (px,py) away from the box.
 */
function pointAABBSep(
  px: number,
  py: number,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
): { nx: number; ny: number; depth: number } | null {
  const dx = px - cx
  const dy = py - cy
  const ox = hw - Math.abs(dx)
  const oy = hh - Math.abs(dy)

  if (ox <= 0 || oy <= 0) {
    // Outside — distance to nearest edge point
    const clx = Math.max(-hw, Math.min(hw, dx))
    const cly = Math.max(-hh, Math.min(hh, dy))
    const ex = dx - clx
    const ey = dy - cly
    const d = Math.hypot(ex, ey)
    if (d < 1e-9) return null
    return { nx: ex / d, ny: ey / d, depth: -d }
  }

  // Inside — push out via nearest face
  if (ox < oy) {
    return { nx: dx >= 0 ? 1 : -1, ny: 0, depth: ox }
  }
  return { nx: 0, ny: dy >= 0 ? 1 : -1, depth: oy }
}

/** Sample `SAMPLES+1` points along segment AB and return the worst-case
 *  AABB separation (most-penetrating point). */
function segAABBClosest(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  SAMPLES = 5,
): { nx: number; ny: number; depth: number; t: number } | null {
  let best: { nx: number; ny: number; depth: number; t: number } | null = null
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES
    const sep = pointAABBSep(
      ax + (bx - ax) * t,
      ay + (by - ay) * t,
      cx,
      cy,
      hw,
      hh,
    )
    if (!sep) continue
    if (!best || sep.depth > best.depth) best = { ...sep, t }
  }
  return best
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface Vert {
  x: number
  y: number
  z: number
  /** Original position — reset to this in hard pass for truly fixed verts. */
  ox: number
  oy: number
  /** Hard-fixed: endpoint or explicit pad position — may not move at all. */
  fixed: boolean
}

interface BinSeg {
  ti: number // trace index
  vi: number // start-vertex index in verts[ti]
  vj: number // end-vertex index
  net: string
  ax: number
  ay: number
  az: number
  bx: number
  by: number
  aFixed: boolean
  bFixed: boolean
}

// ---------------------------------------------------------------------------
// TracePhysicsRelaxer
// ---------------------------------------------------------------------------

/**
 * Session-based physics relaxer for routed traces.
 *
 * ## Usage
 *
 *   relaxer.startSession(resolvedPaths, fixedKeys, netNameFn, obstacles)
 *   while (relaxer.softStep()) { ... visualize ... }
 *   relaxer.hardPass()   // guarantee no remaining penetrations
 *   // resolvedPaths is now updated in-place
 *
 * ## Soft step (Jacobi)
 *
 * Each `softStep()` accumulates separation impulses for every pair of
 * too-close segments from different nets (trace-trace) and for every
 * segment too close to a fixed obstacle (trace-obstacle).  Interior
 * vertices also receive a light string-pull toward the chord midpoint.
 * All impulses are applied simultaneously (Jacobi), then written back to
 * `resolvedPaths` immediately so the caller can visualize each iteration.
 *
 * ## Hard pass (Gauss-Seidel projection)
 *
 * After soft steps converge, `hardPass()` sequentially projects every
 * violated constraint to exact satisfaction:
 *   1. Each trace vertex inside an obstacle is projected out (hard).
 *   2. Each pair of segments still closer than `traceClearance` is
 *      projected to exactly `traceClearance` apart.
 *   3. Fixed vertices are snapped back to their original positions.
 * Runs up to `HARD_PASSES` sequential sweeps until stable.
 *
 * ## Separation factor
 *
 * `separationFactor` (default 2.5) inflates the soft-collision target
 * to `traceClearance × separationFactor`, leaving a
 * `(separationFactor − 2) × traceClearance` wide routing corridor
 * between relaxed traces for new traces to burrow through.
 * The hard pass always uses `traceClearance` as the minimum.
 */
export class TracePhysicsRelaxer {
  /** Soft target separation (inflated). */
  private readonly softClearance: number
  /** Hard minimum separation (= traceClearance, never violated). */
  private readonly hardClearance: number
  /** Spatial grid cell size for binning. */
  private readonly cellSize: number

  // Session state ----------------------------------------------------------
  private verts: Vert[][] = []
  private netNames: string[] = []
  private obstacles: RelaxerObstacle[] = []
  private sessionPaths: ResolvedPath[] = []
  private stringPull = 0.08
  private _hasSession = false

  private static readonly HARD_PASSES = 6
  private static readonly MIN_MOVE = 1e-5

  /**
   * @param traceClearance   Minimum hard separation (= minTraceWidth/2 + margin).
   * @param separationFactor Soft target = traceClearance × separationFactor.
   *   Keep close to 1.0–1.3; the soft field is just a gentle nudge to spread
   *   traces apart.  Hard obstacles and endpoints are enforced absolutely in
   *   hardPass() regardless of this value.
   */
  constructor(traceClearance: number, separationFactor = 1.2) {
    this.hardClearance = traceClearance
    this.softClearance = traceClearance * separationFactor
    this.cellSize = this.softClearance * 2
  }

  get hasSession(): boolean {
    return this._hasSession
  }

  /** The absolute minimum clearance enforced by the hard pass. */
  get capsuleRadius(): number {
    return this.hardClearance
  }

  // ---------------------------------------------------------------------------
  // Session API
  // ---------------------------------------------------------------------------

  /**
   * Initialise a relaxation session.  Must be called before softStep / hardPass.
   * @param resolvedPaths  Modified in-place during the session.
   * @param fixedKeys      "x,y" strings of pad positions — hard-fixed.
   * @param netNameFn      Maps connection name → net (for same-net exemption).
   * @param obstacles      Fixed AABB obstacles (pads, keepouts).
   * @param stringPull     Spring strength toward chord midpoint (0 = off).
   */
  startSession(
    resolvedPaths: ResolvedPath[],
    fixedKeys: Set<string>,
    netNameFn: (name: string) => string,
    obstacles: RelaxerObstacle[] = [],
    stringPull = 0.08,
  ): void {
    this.sessionPaths = resolvedPaths
    this.obstacles = obstacles
    this.stringPull = stringPull
    this._hasSession = true

    this.verts = resolvedPaths.map((rp) =>
      rp.route.map((p, i) => {
        const isEndpoint = i === 0 || i === rp.route.length - 1
        const fixed = isEndpoint || fixedKeys.has(`${p.x},${p.y}`)
        return { x: p.x, y: p.y, z: p.z, ox: p.x, oy: p.y, fixed }
      }),
    )
    this.netNames = resolvedPaths.map((rp) => netNameFn(rp.connectionName))
  }

  /**
   * Run one Jacobi soft iteration.
   * Writes updated positions back to `resolvedPaths` immediately for live
   * visualization.  Returns true if any vertex moved.
   */
  softStep(): boolean {
    if (!this._hasSession) return false

    const segments = this.buildSegments()
    const bins = this.buildBins(segments)
    const impulses = this.verts.map((v) => v.map(() => ({ dx: 0, dy: 0 })))

    // --- Trace-trace soft separation ---
    const seen = new Set<string>()
    for (const [, cell] of bins) {
      for (let i = 0; i < cell.length; i++) {
        const sa = cell[i]!
        for (let j = i + 1; j < cell.length; j++) {
          const sb = cell[j]!
          if (sa.ti === sb.ti) continue
          if (sa.net === sb.net) continue
          if (sa.az !== sb.az) continue
          const key =
            sa.ti < sb.ti
              ? `${sa.ti}:${sa.vi}-${sb.ti}:${sb.vi}`
              : `${sb.ti}:${sb.vi}-${sa.ti}:${sa.vi}`
          if (seen.has(key)) continue
          seen.add(key)

          const c = segSegClosest(
            sa.ax,
            sa.ay,
            sa.bx,
            sa.by,
            sb.ax,
            sb.ay,
            sb.bx,
            sb.by,
          )
          if (c.dist >= this.softClearance) continue

          const depth = this.softClearance - c.dist
          // Gentle nudge — traces soft-repel each other but don't blast apart.
          // Hard violations are resolved absolutely in hardPass().
          const push = depth * 0.1

          this.applySegImpulse(impulses, sa, sb, c.nx, c.ny, c.s, c.t, push)
        }
      }
    }

    // --- Obstacle soft repulsion ---
    for (const seg of segments) {
      for (const obs of this.obstacles) {
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
        const dist = -sep.depth // positive = outside
        if (dist >= this.softClearance) continue
        const push = (this.softClearance - dist) * 0.8
        const wa = 1 - sep.t
        const wb = sep.t
        if (!seg.aFixed) {
          impulses[seg.ti]![seg.vi]!.dx += sep.nx * push * wa
          impulses[seg.ti]![seg.vi]!.dy += sep.ny * push * wa
        }
        if (!seg.bFixed) {
          impulses[seg.ti]![seg.vj]!.dx += sep.nx * push * wb
          impulses[seg.ti]![seg.vj]!.dy += sep.ny * push * wb
        }
      }
    }

    // --- String-pull ---
    if (this.stringPull > 0) {
      for (let ti = 0; ti < this.verts.length; ti++) {
        const verts = this.verts[ti]!
        for (let vi = 1; vi < verts.length - 1; vi++) {
          const v = verts[vi]!
          if (v.fixed) continue
          const prev = verts[vi - 1]!
          const next = verts[vi + 1]!
          if (prev.z !== v.z || next.z !== v.z) continue
          impulses[ti]![vi]!.dx +=
            ((prev.x + next.x) * 0.5 - v.x) * this.stringPull
          impulses[ti]![vi]!.dy +=
            ((prev.y + next.y) * 0.5 - v.y) * this.stringPull
        }
      }
    }

    // --- Apply (Jacobi: all at once) ---
    // Clamp the total displacement per vertex so vertices don't blast away
    // when many pairs contribute simultaneously (happens with dense segments).
    // This is what keeps the soft repulsion "soft" regardless of trace density.
    // Each vertex moves at most this per step; keeps soft repulsion "soft"
    // even when many segment pairs accumulate impulses on the same vertex.
    const maxMove = this.hardClearance * 0.12
    let moved = false
    for (let ti = 0; ti < this.verts.length; ti++) {
      const verts = this.verts[ti]!
      for (let vi = 0; vi < verts.length; vi++) {
        const v = verts[vi]!
        if (v.fixed) continue
        const imp = impulses[ti]![vi]!
        const mag = Math.hypot(imp.dx, imp.dy)
        if (mag < TracePhysicsRelaxer.MIN_MOVE) continue
        const scale = mag > maxMove ? maxMove / mag : 1
        v.x += imp.dx * scale
        v.y += imp.dy * scale
        moved = true
      }
    }

    this.writeBack()
    return moved
  }

  /**
   * Hard-constraint depenetration pass (Gauss-Seidel, sequential).
   *
   * 1. Project every trace vertex out of every obstacle it overlaps.
   * 2. Project every too-close segment pair to exactly `traceClearance` apart.
   * 3. Snap all fixed vertices back to their original positions.
   *
   * Runs multiple sweeps until stable.  Must be called after all softSteps.
   * Writes final positions back to `resolvedPaths` and clears the session.
   */
  hardPass(): void {
    if (!this._hasSession) return

    for (let pass = 0; pass < TracePhysicsRelaxer.HARD_PASSES; pass++) {
      let anyMoved = false

      // 1. Obstacle depenetration (per vertex, sequential)
      for (let ti = 0; ti < this.verts.length; ti++) {
        const verts = this.verts[ti]!
        for (let vi = 0; vi < verts.length; vi++) {
          const v = verts[vi]!
          if (v.fixed) continue
          for (const obs of this.obstacles) {
            if (obs.layers.length > 0 && !obs.layers.includes(v.z)) continue
            const sep = pointAABBSep(v.x, v.y, obs.cx, obs.cy, obs.hw, obs.hh)
            if (!sep || sep.depth <= 0) continue
            // depth > 0 means inside — push out fully
            v.x += sep.nx * (sep.depth + 1e-4)
            v.y += sep.ny * (sep.depth + 1e-4)
            anyMoved = true
          }
        }
      }

      // 2. Trace-trace depenetration (sequential, full correction)
      const segments = this.buildSegments()
      const bins = this.buildBins(segments)
      const seen = new Set<string>()

      for (const [, cell] of bins) {
        for (let i = 0; i < cell.length; i++) {
          const sa = cell[i]!
          for (let j = i + 1; j < cell.length; j++) {
            const sb = cell[j]!
            if (sa.ti === sb.ti) continue
            if (sa.net === sb.net) continue
            if (sa.az !== sb.az) continue
            const key =
              sa.ti < sb.ti
                ? `${sa.ti}:${sa.vi}-${sb.ti}:${sb.vi}`
                : `${sb.ti}:${sb.vi}-${sa.ti}:${sa.vi}`
            if (seen.has(key)) continue
            seen.add(key)

            // Re-read live positions for sequential accuracy
            const va0 = this.verts[sa.ti]![sa.vi]!
            const va1 = this.verts[sa.ti]![sa.vj]!
            const vb0 = this.verts[sb.ti]![sb.vi]!
            const vb1 = this.verts[sb.ti]![sb.vj]!

            const c = segSegClosest(
              va0.x,
              va0.y,
              va1.x,
              va1.y,
              vb0.x,
              vb0.y,
              vb1.x,
              vb1.y,
            )
            if (c.dist >= this.hardClearance) continue

            const correction = this.hardClearance - c.dist + 1e-4

            // Determine how to split correction between the two segments
            const saMovable = !va0.fixed || !va1.fixed
            const sbMovable = !vb0.fixed || !vb1.fixed

            const saShare = saMovable && sbMovable ? 0.5 : saMovable ? 1.0 : 0.0
            const sbShare = saMovable && sbMovable ? 0.5 : sbMovable ? 1.0 : 0.0

            if (saShare > 0) {
              const push = correction * saShare
              if (!va0.fixed) {
                va0.x += c.nx * push * (1 - c.s)
                va0.y += c.ny * push * (1 - c.s)
              }
              if (!va1.fixed) {
                va1.x += c.nx * push * c.s
                va1.y += c.ny * push * c.s
              }
              anyMoved = true
            }
            if (sbShare > 0) {
              const push = correction * sbShare
              if (!vb0.fixed) {
                vb0.x -= c.nx * push * (1 - c.t)
                vb0.y -= c.ny * push * (1 - c.t)
              }
              if (!vb1.fixed) {
                vb1.x -= c.nx * push * c.t
                vb1.y -= c.ny * push * c.t
              }
              anyMoved = true
            }
          }
        }
      }

      // 3. Snap fixed vertices back to original positions (hard constraint)
      for (const verts of this.verts) {
        for (const v of verts) {
          if (!v.fixed) continue
          if (Math.abs(v.x - v.ox) > 1e-9 || Math.abs(v.y - v.oy) > 1e-9) {
            v.x = v.ox
            v.y = v.oy
            anyMoved = true
          }
        }
      }

      if (!anyMoved) break
    }

    this.writeBack()
    this._hasSession = false
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildSegments(): BinSeg[] {
    const segs: BinSeg[] = []
    for (let ti = 0; ti < this.verts.length; ti++) {
      const verts = this.verts[ti]!
      const net = this.netNames[ti]!
      for (let vi = 0; vi < verts.length - 1; vi++) {
        const va = verts[vi]!
        const vb = verts[vi + 1]!
        if (va.z !== vb.z) continue // skip layer-transition edges
        segs.push({
          ti,
          vi,
          vj: vi + 1,
          net,
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
    return segs
  }

  private buildBins(segs: BinSeg[]): Map<string, BinSeg[]> {
    const bins = new Map<string, BinSeg[]>()
    const cs = this.cellSize
    const r = this.softClearance
    for (const seg of segs) {
      const x0 = Math.min(seg.ax, seg.bx)
      const x1 = Math.max(seg.ax, seg.bx)
      const y0 = Math.min(seg.ay, seg.by)
      const y1 = Math.max(seg.ay, seg.by)
      const gx0 = Math.floor((x0 - r) / cs)
      const gx1 = Math.floor((x1 + r) / cs)
      const gy0 = Math.floor((y0 - r) / cs)
      const gy1 = Math.floor((y1 + r) / cs)
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const key = `${gx},${gy}`
          let list = bins.get(key)
          if (!list) {
            list = []
            bins.set(key, list)
          }
          list.push(seg)
        }
      }
    }
    return bins
  }

  /** Accumulate Jacobi impulse for one segment pair. */
  private applySegImpulse(
    impulses: { dx: number; dy: number }[][],
    sa: BinSeg,
    sb: BinSeg,
    nx: number,
    ny: number,
    s: number,
    t: number,
    push: number,
  ) {
    if (!sa.aFixed) {
      impulses[sa.ti]![sa.vi]!.dx += nx * push * (1 - s)
      impulses[sa.ti]![sa.vi]!.dy += ny * push * (1 - s)
    }
    if (!sa.bFixed) {
      impulses[sa.ti]![sa.vj]!.dx += nx * push * s
      impulses[sa.ti]![sa.vj]!.dy += ny * push * s
    }
    if (!sb.aFixed) {
      impulses[sb.ti]![sb.vi]!.dx -= nx * push * (1 - t)
      impulses[sb.ti]![sb.vi]!.dy -= ny * push * (1 - t)
    }
    if (!sb.bFixed) {
      impulses[sb.ti]![sb.vj]!.dx -= nx * push * t
      impulses[sb.ti]![sb.vj]!.dy -= ny * push * t
    }
  }

  private writeBack(): void {
    for (let ti = 0; ti < this.sessionPaths.length; ti++) {
      const rp = this.sessionPaths[ti]!
      const verts = this.verts[ti]!
      for (let vi = 0; vi < rp.route.length; vi++) {
        rp.route[vi]!.x = verts[vi]!.x
        rp.route[vi]!.y = verts[vi]!.y
      }
    }
  }
}
