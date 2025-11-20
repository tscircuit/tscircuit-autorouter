// lib/solvers/rectdiff/geometry.ts
import type { XYRect } from "./types"

export const EPS = 1e-9
export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v))
export const gt = (a: number, b: number) => a > b + EPS
export const gte = (a: number, b: number) => a > b - EPS
export const lt = (a: number, b: number) => a < b - EPS
export const lte = (a: number, b: number) => a < b + EPS

export function overlaps(a: XYRect, b: XYRect) {
  return !(
    a.x + a.width <= b.x + EPS ||
    b.x + b.width <= a.x + EPS ||
    a.y + a.height <= b.y + EPS ||
    b.y + b.height <= a.y + EPS
  )
}

export function containsPoint(r: XYRect, x: number, y: number) {
  return (
    x >= r.x - EPS &&
    x <= r.x + r.width + EPS &&
    y >= r.y - EPS &&
    y <= r.y + r.height + EPS
  )
}

export function distancePointToRectEdges(px: number, py: number, r: XYRect) {
  const edges: [number, number, number, number][] = [
    [r.x, r.y, r.x + r.width, r.y],
    [r.x + r.width, r.y, r.x + r.width, r.y + r.height],
    [r.x + r.width, r.y + r.height, r.x, r.y + r.height],
    [r.x, r.y + r.height, r.x, r.y],
  ]
  let best = Infinity
  for (const [x1, y1, x2, y2] of edges) {
    const A = px - x1,
      B = py - y1,
      C = x2 - x1,
      D = y2 - y1
    const dot = A * C + B * D
    const lenSq = C * C + D * D
    let t = lenSq !== 0 ? dot / lenSq : 0
    t = clamp(t, 0, 1)
    const xx = x1 + t * C
    const yy = y1 + t * D
    best = Math.min(best, Math.hypot(px - xx, py - yy))
  }
  return best
}

// --- directional expansion caps (respect board + blockers + aspect) ---

function maxExpandRight(
  r: XYRect,
  bounds: XYRect,
  blockers: XYRect[],
  maxAspect: number | null | undefined,
) {
  // Start with board boundary
  let maxWidth = bounds.x + bounds.width - r.x

  // Check all blockers that could limit rightward expansion
  for (const b of blockers) {
    // Only consider blockers that vertically overlap with current rect
    const verticallyOverlaps =
      r.y + r.height > b.y + EPS && b.y + b.height > r.y + EPS
    if (verticallyOverlaps) {
      // Blocker is to the right - limits how far we can expand
      if (gte(b.x, r.x + r.width)) {
        maxWidth = Math.min(maxWidth, b.x - r.x)
      }
      // Blocker overlaps current position - can't expand at all
      else if (
        b.x + b.width > r.x + r.width - EPS &&
        b.x < r.x + r.width + EPS
      ) {
        return 0
      }
    }
  }

  let e = Math.max(0, maxWidth - r.width)
  if (e <= 0) return 0

  // Apply aspect ratio constraint
  if (maxAspect != null) {
    const w = r.width,
      h = r.height
    if (w >= h) e = Math.min(e, maxAspect * h - w)
  }
  return Math.max(0, e)
}

function maxExpandDown(
  r: XYRect,
  bounds: XYRect,
  blockers: XYRect[],
  maxAspect: number | null | undefined,
) {
  // Start with board boundary
  let maxHeight = bounds.y + bounds.height - r.y

  // Check all blockers that could limit downward expansion
  for (const b of blockers) {
    // Only consider blockers that horizontally overlap with current rect
    const horizOverlaps = r.x + r.width > b.x + EPS && b.x + b.width > r.x + EPS
    if (horizOverlaps) {
      // Blocker is below - limits how far we can expand
      if (gte(b.y, r.y + r.height)) {
        maxHeight = Math.min(maxHeight, b.y - r.y)
      }
      // Blocker overlaps current position - can't expand at all
      else if (
        b.y + b.height > r.y + r.height - EPS &&
        b.y < r.y + r.height + EPS
      ) {
        return 0
      }
    }
  }

  let e = Math.max(0, maxHeight - r.height)
  if (e <= 0) return 0

  // Apply aspect ratio constraint
  if (maxAspect != null) {
    const w = r.width,
      h = r.height
    if (h >= w) e = Math.min(e, maxAspect * w - h)
  }
  return Math.max(0, e)
}

function maxExpandLeft(
  r: XYRect,
  bounds: XYRect,
  blockers: XYRect[],
  maxAspect: number | null | undefined,
) {
  // Start with board boundary
  let minX = bounds.x

  // Check all blockers that could limit leftward expansion
  for (const b of blockers) {
    // Only consider blockers that vertically overlap with current rect
    const verticallyOverlaps =
      r.y + r.height > b.y + EPS && b.y + b.height > r.y + EPS
    if (verticallyOverlaps) {
      // Blocker is to the left - limits how far we can expand
      if (lte(b.x + b.width, r.x)) {
        minX = Math.max(minX, b.x + b.width)
      }
      // Blocker overlaps current position - can't expand at all
      else if (b.x < r.x + EPS && b.x + b.width > r.x - EPS) {
        return 0
      }
    }
  }

  let e = Math.max(0, r.x - minX)
  if (e <= 0) return 0

  // Apply aspect ratio constraint
  if (maxAspect != null) {
    const w = r.width,
      h = r.height
    if (w >= h) e = Math.min(e, maxAspect * h - w)
  }
  return Math.max(0, e)
}

function maxExpandUp(
  r: XYRect,
  bounds: XYRect,
  blockers: XYRect[],
  maxAspect: number | null | undefined,
) {
  // Start with board boundary
  let minY = bounds.y

  // Check all blockers that could limit upward expansion
  for (const b of blockers) {
    // Only consider blockers that horizontally overlap with current rect
    const horizOverlaps = r.x + r.width > b.x + EPS && b.x + b.width > r.x + EPS
    if (horizOverlaps) {
      // Blocker is above - limits how far we can expand
      if (lte(b.y + b.height, r.y)) {
        minY = Math.max(minY, b.y + b.height)
      }
      // Blocker overlaps current position - can't expand at all
      else if (b.y < r.y + EPS && b.y + b.height > r.y - EPS) {
        return 0
      }
    }
  }

  let e = Math.max(0, r.y - minY)
  if (e <= 0) return 0

  // Apply aspect ratio constraint
  if (maxAspect != null) {
    const w = r.width,
      h = r.height
    if (h >= w) e = Math.min(e, maxAspect * w - h)
  }
  return Math.max(0, e)
}

/** Grow a rect around (startX,startY), honoring bounds/blockers/aspect/min sizes */
export function expandRectFromSeed(
  startX: number,
  startY: number,
  gridSize: number,
  bounds: XYRect,
  blockers: XYRect[],
  initialCellRatio: number,
  maxAspectRatio: number | null | undefined,
  minReq: { width: number; height: number },
): XYRect | null {
  const minSide = Math.max(1e-9, gridSize * initialCellRatio)
  const initialW = Math.max(minSide, minReq.width)
  const initialH = Math.max(minSide, minReq.height)

  const strategies = [
    { ox: 0, oy: 0 },
    { ox: -initialW, oy: 0 },
    { ox: 0, oy: -initialH },
    { ox: -initialW, oy: -initialH },
    { ox: -initialW / 2, oy: -initialH / 2 },
  ]

  let best: XYRect | null = null
  let bestArea = 0

  STRATS: for (const s of strategies) {
    let r: XYRect = {
      x: startX + s.ox,
      y: startY + s.oy,
      width: initialW,
      height: initialH,
    }

    // keep initial inside board
    if (
      lt(r.x, bounds.x) ||
      lt(r.y, bounds.y) ||
      gt(r.x + r.width, bounds.x + bounds.width) ||
      gt(r.y + r.height, bounds.y + bounds.height)
    ) {
      continue
    }

    // no initial overlap
    for (const b of blockers) if (overlaps(r, b)) continue STRATS

    // greedy expansions in 4 directions
    let improved = true
    while (improved) {
      improved = false
      const eR = maxExpandRight(r, bounds, blockers, maxAspectRatio)
      if (eR > 0) {
        r = { ...r, width: r.width + eR }
        improved = true
      }

      const eD = maxExpandDown(r, bounds, blockers, maxAspectRatio)
      if (eD > 0) {
        r = { ...r, height: r.height + eD }
        improved = true
      }

      const eL = maxExpandLeft(r, bounds, blockers, maxAspectRatio)
      if (eL > 0) {
        r = { x: r.x - eL, y: r.y, width: r.width + eL, height: r.height }
        improved = true
      }

      const eU = maxExpandUp(r, bounds, blockers, maxAspectRatio)
      if (eU > 0) {
        r = { x: r.x, y: r.y - eU, width: r.width, height: r.height + eU }
        improved = true
      }
    }

    if (r.width + EPS >= minReq.width && r.height + EPS >= minReq.height) {
      const area = r.width * r.height
      if (area > bestArea) {
        best = r
        bestArea = area
      }
    }
  }

  return best
}

export function intersect1D(a0: number, a1: number, b0: number, b1: number) {
  const lo = Math.max(a0, b0)
  const hi = Math.min(a1, b1)
  return hi > lo + EPS ? ([lo, hi] as const) : null
}

/** Return A \ B as up to 4 non-overlapping rectangles (or [A] if no overlap). */
export function subtractRect2D(A: XYRect, B: XYRect): XYRect[] {
  if (!overlaps(A, B)) return [A]

  const Xi = intersect1D(A.x, A.x + A.width, B.x, B.x + B.width)
  const Yi = intersect1D(A.y, A.y + A.height, B.y, B.y + B.height)
  if (!Xi || !Yi) return [A]

  const [X0, X1] = Xi
  const [Y0, Y1] = Yi
  const out: XYRect[] = []

  // Left strip
  if (X0 > A.x + EPS) {
    out.push({ x: A.x, y: A.y, width: X0 - A.x, height: A.height })
  }
  // Right strip
  if (A.x + A.width > X1 + EPS) {
    out.push({ x: X1, y: A.y, width: A.x + A.width - X1, height: A.height })
  }
  // Top wedge in the middle band
  const midW = Math.max(0, X1 - X0)
  if (midW > EPS && Y0 > A.y + EPS) {
    out.push({ x: X0, y: A.y, width: midW, height: Y0 - A.y })
  }
  // Bottom wedge in the middle band
  if (midW > EPS && A.y + A.height > Y1 + EPS) {
    out.push({ x: X0, y: Y1, width: midW, height: A.y + A.height - Y1 })
  }

  return out.filter((r) => r.width > EPS && r.height > EPS)
}
