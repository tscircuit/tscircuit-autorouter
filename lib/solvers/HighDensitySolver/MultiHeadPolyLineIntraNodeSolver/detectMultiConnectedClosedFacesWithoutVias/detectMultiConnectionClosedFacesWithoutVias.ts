import type { Bounds } from "@tscircuit/math-utils"
import { MHPoint, PolyLine } from "../types1"

// ── Geometry & DCEL ───────────────────────────────────────────────────────────

const EPS = 1e-9
const SCALE = 1 / EPS // 1e9 – matches the original precision

interface Point {
  x: number
  y: number
  /** lazily cached key (internal use) */
  _k?: string
}
interface Segment {
  start: Point
  end: Point
  connectionName: string | null
  layer: number
}

function almostEqual(a: number, b: number) {
  return Math.abs(a - b) < EPS
}

/** Cheap, cache-once key generator (multiply instead of divide) */
function pointKey(p: Point): string {
  return (p._k ??= `${Math.round(p.x * SCALE)}:${Math.round(p.y * SCALE)}`)
}

function cross(ax: number, ay: number, bx: number, by: number) {
  return ax * by - ay * bx
}

function segmentIntersection(
  p1: Point,
  p2: Point,
  q1: Point,
  q2: Point,
): Point | null {
  const r = { x: p2.x - p1.x, y: p2.y - p1.y }
  const s = { x: q2.x - q1.x, y: q2.y - q1.y }
  const rxs = cross(r.x, r.y, s.x, s.y)
  const qp = { x: q1.x - p1.x, y: q1.y - p1.y }

  if (almostEqual(rxs, 0)) return null // parallel / collinear

  const t = cross(qp.x, qp.y, s.x, s.y) / rxs
  const u = cross(qp.x, qp.y, r.x, r.y) / rxs
  if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS)
    return { x: p1.x + t * r.x, y: p1.y + t * r.y }

  return null
}

function isOnSegment(p: Point, a: Point, b: Point) {
  const d_ap = Math.hypot(p.x - a.x, p.y - a.y)
  const d_pb = Math.hypot(p.x - b.x, p.y - b.y)
  const d_ab = Math.hypot(a.x - b.x, a.y - b.y)
  return almostEqual(d_ap + d_pb, d_ab)
}

interface DcelVertex extends Point {
  id: number
  isVia: boolean
  connectionNames: Set<string>
  outgoingEdges: DcelHalfEdge[]
}
interface DcelHalfEdge {
  id: number
  origin: DcelVertex
  twin: DcelHalfEdge | null
  next: DcelHalfEdge | null
  face: DcelFace | null
  connectionName: string | null
  layer: number
  visited: boolean
}
interface DcelFace {
  id: number
  outerComponent: DcelHalfEdge | null
  innerComponents: DcelHalfEdge[]
  isOuterFace: boolean
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function detectMultiConnectionClosedFacesWithoutVias(
  polyLines: PolyLine[],
  bounds: Bounds,
): boolean {
  const allSegments: Segment[] = []
  const viaPoints = new Map<
    string,
    { point: MHPoint; connectionName: string }
  >()

  // 1. Gather segments & vias --------------------------------------------------
  for (const pl of polyLines) {
    const path = [pl.start, ...pl.mPoints, pl.end]
    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i],
        p2 = path[i + 1]
      allSegments.push({
        start: { x: p1.x, y: p1.y },
        end: { x: p2.x, y: p2.y },
        connectionName: pl.connectionName,
        layer: p1.z2,
      })
      if (p1.z1 !== p1.z2)
        viaPoints.set(pointKey(p1), {
          point: p1,
          connectionName: pl.connectionName,
        })
    }
    const last = path.at(-1)!
    if (last.z1 !== last.z2)
      viaPoints.set(pointKey(last), {
        point: last,
        connectionName: pl.connectionName,
      })
  }

  // 2. Board outline -----------------------------------------------------------
  const B = bounds,
    boundaryLayer = 0
  allSegments.push(
    {
      start: { x: B.minX, y: B.minY },
      end: { x: B.maxX, y: B.minY },
      connectionName: null,
      layer: boundaryLayer,
    },
    {
      start: { x: B.maxX, y: B.minY },
      end: { x: B.maxX, y: B.maxY },
      connectionName: null,
      layer: boundaryLayer,
    },
    {
      start: { x: B.maxX, y: B.maxY },
      end: { x: B.minX, y: B.maxY },
      connectionName: null,
      layer: boundaryLayer,
    },
    {
      start: { x: B.minX, y: B.maxY },
      end: { x: B.minX, y: B.minY },
      connectionName: null,
      layer: boundaryLayer,
    },
  )

  // 3. Vertices and intersections ---------------------------------------------
  const verticesMap = new Map<string, DcelVertex>()
  let vId = 0

  const getOrCreateVertex = (p: Point, cn?: string | null): DcelVertex => {
    const k = pointKey(p)
    let v = verticesMap.get(k)
    if (!v) {
      const isVia = viaPoints.has(k)
      v = {
        id: vId++,
        x: p.x,
        y: p.y,
        isVia,
        connectionNames: new Set(),
        outgoingEdges: [],
      }
      verticesMap.set(k, v)
      if (isVia) v.connectionNames.add(viaPoints.get(k)!.connectionName)
    }
    if (cn) v.connectionNames.add(cn)
    return v
  }

  /** Fast lookup once every point is guaranteed to exist */
  const getVertex = (p: Point): DcelVertex => {
    const v = verticesMap.get(pointKey(p))
    if (!v) throw new Error("Vertex missing – should have been created earlier")
    return v
  }

  // seed endpoints
  for (const s of allSegments) {
    getOrCreateVertex(s.start, s.connectionName)
    getOrCreateVertex(s.end, s.connectionName)
  }

  // detect intersections
  const breakpoints = new Map<Segment, Point[]>()
  allSegments.forEach((seg) => breakpoints.set(seg, []))

  for (let i = 0; i < allSegments.length; i++) {
    for (let j = i + 1; j < allSegments.length; j++) {
      if (allSegments[i].layer !== allSegments[j].layer) continue
      const ip = segmentIntersection(
        allSegments[i].start,
        allSegments[i].end,
        allSegments[j].start,
        allSegments[j].end,
      )
      if (!ip) continue
      getOrCreateVertex(ip)
      if (isOnSegment(ip, allSegments[i].start, allSegments[i].end))
        breakpoints.get(allSegments[i])!.push(ip)
      if (isOnSegment(ip, allSegments[j].start, allSegments[j].end))
        breakpoints.get(allSegments[j])!.push(ip)
    }
  }

  // 4. Half-edge construction (now uses getVertex) ----------------------------
  const halfEdges: DcelHalfEdge[] = []
  let eId = 0

  for (const seg of allSegments) {
    const pts = [seg.start, ...breakpoints.get(seg)!, seg.end]
    pts.sort((a, b) => {
      const dx = seg.end.x - seg.start.x
      const dy = seg.end.y - seg.start.y
      return Math.abs(dx) > Math.abs(dy)
        ? (a.x - seg.start.x) / dx - (b.x - seg.start.x) / dx
        : Math.abs(dy) < EPS
          ? 0
          : (a.y - seg.start.y) / dy - (b.y - seg.start.y) / dy
    })

    const uniques: Point[] = []
    if (pts.length) uniques.push(pts[0])
    for (let i = 1; i < pts.length; i++)
      if (
        !almostEqual(pts[i].x, pts[i - 1].x) ||
        !almostEqual(pts[i].y, pts[i - 1].y)
      )
        uniques.push(pts[i])

    for (let i = 0; i < uniques.length - 1; i++) {
      const p1 = uniques[i],
        p2 = uniques[i + 1]
      const v1 = getVertex(p1)
      const v2 = getVertex(p2)
      if (seg.connectionName) {
        // keep connection bookkeeping
        v1.connectionNames.add(seg.connectionName)
        v2.connectionNames.add(seg.connectionName)
      }
      if (v1 === v2) continue // zero-length guard

      const e1: DcelHalfEdge = {
        id: eId++,
        origin: v1,
        twin: null,
        next: null,
        face: null,
        connectionName: seg.connectionName,
        layer: seg.layer,
        visited: false,
      }
      const e2: DcelHalfEdge = {
        id: eId++,
        origin: v2,
        twin: e1,
        next: null,
        face: null,
        connectionName: seg.connectionName,
        layer: seg.layer,
        visited: false,
      }
      e1.twin = e2
      halfEdges.push(e1, e2)
      v1.outgoingEdges.push(e1)
      v2.outgoingEdges.push(e2)
    }
  }

  // 5. Link edges CCW ----------------------------------------------------------
  for (const v of verticesMap.values()) {
    v.outgoingEdges.sort((a, b) => {
      const p1 = a.twin!.origin,
        p2 = b.twin!.origin
      return (
        Math.atan2(p1.y - v.y, p1.x - v.x) - Math.atan2(p2.y - v.y, p2.x - v.x)
      )
    })
    const n = v.outgoingEdges.length
    for (let i = 0; i < n; i++) {
      const prev = v.outgoingEdges[(i - 1 + n) % n]
      const cur = v.outgoingEdges[i]
      if (cur.twin) cur.twin.next = prev
    }
  }

  // 6. Traverse faces & rule-check --------------------------------------------
  const faces: DcelFace[] = []
  let fId = 0,
    outer: DcelFace | null = null,
    maxArea = -Infinity

  for (const e of halfEdges) {
    if (e.visited) continue

    const face: DcelFace = {
      id: fId++,
      outerComponent: e,
      innerComponents: [],
      isOuterFace: false,
    }
    faces.push(face)

    let cur: DcelHalfEdge | null = e
    let area = 0
    const fVerts: DcelVertex[] = [],
      fConns = new Set<string | null>()

    do {
      if (!cur || cur.visited) {
        area = NaN
        break
      } // malformed
      cur.visited = true
      cur.face = face
      fVerts.push(cur.origin)
      if (cur.connectionName) fConns.add(cur.connectionName)
      const p1 = cur.origin,
        p2 = cur.twin!.origin
      area += p1.x * p2.y - p2.x * p1.y
      cur = cur.next
    } while (cur !== e && cur)

    if (!cur || cur !== e || isNaN(area)) continue // incomplete face
    area = 0.5 * Math.abs(area)

    if (area > maxArea) {
      if (outer) outer.isOuterFace = false
      outer = face
      face.isOuterFace = true
      maxArea = area
    }

    if (face.isOuterFace) continue // only inner faces matter

    const actual = [...fConns].filter(Boolean)
    if (actual.length <= 1) continue

    const hasVia = fVerts.some((v) => v.isVia)
    if (!hasVia) return true // **problem detected**
  }

  return false
}
