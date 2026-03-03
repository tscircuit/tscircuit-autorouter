import type { Point } from "polyanya"

interface AABB {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

class UnionFind {
  parent: number[]
  rank: number[]
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
    this.rank = new Array(n).fill(0)
  }
  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]!)
    return this.parent[x]!
  }
  union(a: number, b: number) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    if (this.rank[ra]! < this.rank[rb]!) {
      this.parent[ra] = rb
    } else if (this.rank[ra]! > this.rank[rb]!) {
      this.parent[rb] = ra
    } else {
      this.parent[rb] = ra
      this.rank[ra]!++
    }
  }
}

function aabbsOverlap(a: AABB, b: AABB): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
}

/**
 * Given an array of polygons (each a 4-vertex axis-aligned rect from rectToPolygon),
 * merge overlapping ones into non-self-intersecting rectilinear union polygons.
 *
 * Returns an array of polygon outlines (each a Point[]).
 * Non-overlapping rects pass through unchanged.
 */
export function mergeOverlappingRects(polygons: Point[][]): Point[][] {
  if (polygons.length <= 1) return polygons

  // Convert each polygon to an AABB
  const aabbs: AABB[] = polygons.map((poly) => {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of poly) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
    return { minX, minY, maxX, maxY }
  })

  // Group overlapping AABBs using union-find + sweep line on X axis.
  // Sort by minX, then sweep: for each rect, only check rects whose
  // minX < current maxX (active set). Remove expired rects as we go.
  const uf = new UnionFind(aabbs.length)
  const order = Array.from({ length: aabbs.length }, (_, i) => i)
  order.sort((a, b) => aabbs[a]!.minX - aabbs[b]!.minX)

  // Active set: indices sorted by maxX (earliest expiry first)
  const active: number[] = []

  for (const i of order) {
    const ai = aabbs[i]!
    // Remove expired rects from active set
    let writeIdx = 0
    for (let k = 0; k < active.length; k++) {
      if (aabbs[active[k]!]!.maxX > ai.minX) {
        active[writeIdx++] = active[k]!
      }
    }
    active.length = writeIdx

    // Check overlap with all active rects
    for (let k = 0; k < active.length; k++) {
      const j = active[k]!
      if (aabbsOverlap(ai, aabbs[j]!)) {
        uf.union(i, j)
      }
    }
    active.push(i)
  }

  // Collect groups
  const groups = new Map<number, number[]>()
  for (let i = 0; i < aabbs.length; i++) {
    const root = uf.find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(i)
  }

  const result: Point[][] = []
  for (const indices of groups.values()) {
    if (indices.length === 1) {
      result.push(polygons[indices[0]!]!)
    } else {
      const groupAabbs = indices.map((i) => aabbs[i]!)
      const unionPolygons = rectilinearUnion(groupAabbs)
      for (const poly of unionPolygons) {
        result.push(poly)
      }
    }
  }

  return result
}

/**
 * Compute the rectilinear union of a set of AABBs as polygon outlines.
 * Uses a grid-based approach: build a grid from unique x/y coords,
 * mark filled cells, collect directed boundary edges, chain into polygons.
 */
function rectilinearUnion(rects: AABB[]): Point[][] {
  // Collect unique sorted x and y coordinates → grid lines
  const xSet = new Set<number>()
  const ySet = new Set<number>()
  for (const r of rects) {
    xSet.add(r.minX)
    xSet.add(r.maxX)
    ySet.add(r.minY)
    ySet.add(r.maxY)
  }
  const xs = Array.from(xSet).sort((a, b) => a - b)
  const ys = Array.from(ySet).sort((a, b) => a - b)

  const cols = xs.length - 1
  const rows = ys.length - 1
  if (cols <= 0 || rows <= 0) return []

  // Mark which grid cells are filled
  const filled: boolean[][] = Array.from({ length: rows }, () =>
    new Array(cols).fill(false) as boolean[],
  )

  for (const r of rects) {
    const cStart = xs.indexOf(r.minX)
    const cEnd = xs.indexOf(r.maxX)
    const rStart = ys.indexOf(r.minY)
    const rEnd = ys.indexOf(r.maxY)
    for (let row = rStart; row < rEnd; row++) {
      for (let col = cStart; col < cEnd; col++) {
        filled[row]![col] = true
      }
    }
  }

  // Collect directed boundary edges using grid-point indices.
  // Orientation: CCW around filled regions (filled on left side of walk direction).
  //
  // For a filled cell (row, col) spanning [xs[col]..xs[col+1]] x [ys[row]..ys[row+1]]:
  //   Bottom neighbor empty (row-1): edge east  from (col,row) to (col+1,row)
  //   Right neighbor empty (col+1):  edge north from (col+1,row) to (col+1,row+1)
  //   Top neighbor empty (row+1):    edge west  from (col+1,row+1) to (col,row+1)
  //   Left neighbor empty (col-1):   edge south from (col,row+1) to (col,row)

  function isFilled(r: number, c: number): boolean {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return false
    return filled[r]![c]!
  }

  // Grid point key: "gx,gy" (grid indices, not coordinates)
  function gpKey(gx: number, gy: number): string {
    return `${gx},${gy}`
  }

  // Map from start grid-point key to {endGx, endGy}
  // Each boundary vertex has exactly one outgoing edge per contour.
  const outgoing = new Map<string, { gx: number; gy: number }>()

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (!filled[row]![col]) continue

      if (!isFilled(row - 1, col)) {
        // Bottom boundary → edge east
        outgoing.set(gpKey(col, row), { gx: col + 1, gy: row })
      }
      if (!isFilled(row, col + 1)) {
        // Right boundary → edge north
        outgoing.set(gpKey(col + 1, row), { gx: col + 1, gy: row + 1 })
      }
      if (!isFilled(row + 1, col)) {
        // Top boundary → edge west
        outgoing.set(gpKey(col + 1, row + 1), { gx: col, gy: row + 1 })
      }
      if (!isFilled(row, col - 1)) {
        // Left boundary → edge south
        outgoing.set(gpKey(col, row + 1), { gx: col, gy: row })
      }
    }
  }

  // Chain directed edges into closed polygons
  const visited = new Set<string>()
  const polygons: Point[][] = []

  for (const [startKey] of outgoing) {
    if (visited.has(startKey)) continue

    const polygon: Point[] = []
    let currentKey = startKey

    while (!visited.has(currentKey)) {
      visited.add(currentKey)
      const next = outgoing.get(currentKey)
      if (!next) break

      // Convert grid index to real coordinate
      const [gxStr, gyStr] = currentKey.split(",")
      const pt: Point = { x: xs[Number(gxStr)]!, y: ys[Number(gyStr)]! }

      // Merge collinear: if last two points + this one are collinear, replace the middle
      if (polygon.length >= 2) {
        const prev = polygon[polygon.length - 1]!
        const prevPrev = polygon[polygon.length - 2]!
        if (isCollinear(prevPrev, prev, pt)) {
          polygon[polygon.length - 1] = pt
        } else {
          polygon.push(pt)
        }
      } else {
        polygon.push(pt)
      }

      currentKey = gpKey(next.gx, next.gy)
    }

    // Check wrap-around collinearity at both ends
    // End: secondToLast → last → first
    if (polygon.length >= 3) {
      const secondToLast = polygon[polygon.length - 2]!
      const last = polygon[polygon.length - 1]!
      const first = polygon[0]!
      if (isCollinear(secondToLast, last, first)) {
        polygon.pop()
      }
    }
    // Start: last → first → second
    if (polygon.length >= 3) {
      const last = polygon[polygon.length - 1]!
      const first = polygon[0]!
      const second = polygon[1]!
      if (isCollinear(last, first, second)) {
        polygon.shift()
      }
    }

    if (polygon.length >= 3) {
      polygons.push(polygon)
    }
  }

  return polygons
}

function isCollinear(a: Point, b: Point, c: Point): boolean {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  return Math.abs(cross) < 1e-10
}
