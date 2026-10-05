import type { Bounds } from "@tscircuit/math-utils"

// Define basic types
interface Point {
  x: number
  y: number
}

export interface Segment {
  start: Point
  end: Point
  connectionName?: string
}

// EPS is used for floating point comparisons
const EPS = 1e-9

export function almostEqual(a: number, b: number, eps: number = EPS): boolean {
  return Math.abs(a - b) < eps
}

export function pointKey(p: Point, eps: number = EPS): string {
  // Hashable key for deduplication
  return `${Math.round(p.x / eps)}:${Math.round(p.y / eps)}`
}

export function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx
}

export function segmentIntersection(
  p: Point,
  p2: Point,
  q: Point,
  q2: Point,
): Point | null {
  // Returns intersection point of segments pp2 and qq2 or null if none
  const r = { x: p2.x - p.x, y: p2.y - p.y }
  const s = { x: q2.x - q.x, y: q2.y - q.y }
  const denom = cross(r.x, r.y, s.x, s.y)
  if (almostEqual(denom, 0)) return null // Parallel or collinear
  const qp = { x: q.x - p.x, y: q.y - p.y }
  const t = cross(qp.x, qp.y, s.x, s.y) / denom
  const u = cross(qp.x, qp.y, r.x, r.y) / denom
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null // Outside
  return { x: p.x + t * r.x, y: p.y + t * r.y }
}

export function polygonArea(points: Point[]): number {
  let a = 0
  for (let i = 0, n = points.length; i < n; ++i) {
    const j = (i + 1) % n
    a += points[i].x * points[j].y - points[j].x * points[i].y
  }
  return 0.5 * a
}

export function polygonCentroid(points: Point[]): Point | null {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0, n = points.length; i < n; ++i) {
    const j = (i + 1) % n
    const crossVal = points[i].x * points[j].y - points[j].x * points[i].y
    a += crossVal
    cx += (points[i].x + points[j].x) * crossVal
    cy += (points[i].y + points[j].y) * crossVal
  }
  a *= 0.5
  if (almostEqual(a, 0)) return null
  cx /= 6 * a
  cy /= 6 * a
  return { x: cx, y: cy }
}

// DCEL structures
export class Vertex implements Point {
  x: number
  y: number
  out: number[] // Outgoing half-edge indices
  connectionNames: Set<string> // Names of connections passing through this vertex

  constructor(x: number, y: number) {
    this.x = x
    this.y = y
    this.out = []
    this.connectionNames = new Set()
  }
}

export class HalfEdge {
  orig: number // Vertex index
  dest: number // Vertex index
  twin: number | null // Half-edge index
  next: number | null // Half-edge index (around left face)
  visited: boolean

  constructor(orig: number, dest: number) {
    this.orig = orig
    this.dest = dest
    this.twin = null
    this.next = null
    this.visited = false
  }
}

interface FaceVertex extends Point {
  connectionNames?: Set<string>
}

export interface Face {
  vertices: FaceVertex[]
  centroid: Point
}

interface ComputeRegionCentroidsResult {
  centroids: Point[]
  faces: Face[]
  allVertices: Vertex[] // These vertices now include connectionNames
}

export function getCentroidsFromInnerBoxIntersections(
  rectangle: Bounds,
  userSegments: Segment[],
): ComputeRegionCentroidsResult {
  // 1. Build full segment list (user + rectangle perimeter)
  const rectEdges: Segment[] = [
    {
      start: { x: rectangle.minX, y: rectangle.minY },
      end: { x: rectangle.maxX, y: rectangle.minY },
    },
    {
      start: { x: rectangle.maxX, y: rectangle.minY },
      end: { x: rectangle.maxX, y: rectangle.maxY },
    },
    {
      start: { x: rectangle.maxX, y: rectangle.maxY },
      end: { x: rectangle.minX, y: rectangle.maxY },
    },
    {
      start: { x: rectangle.minX, y: rectangle.maxY },
      end: { x: rectangle.minX, y: rectangle.minY },
    },
  ]
  const segments: Segment[] = [...userSegments, ...rectEdges]

  // 2. Collect breakpoints on each segment (endpoints + intersections)
  const breakMap: Point[][] = segments.map(() => []) // Array of arrays of points per segment

  // Add endpoints
  for (let i = 0; i < segments.length; ++i) {
    const s = segments[i]
    breakMap[i].push(s.start, s.end)
  }

  // Intersections between segments
  for (let i = 0; i < segments.length; ++i) {
    for (let j = i + 1; j < segments.length; ++j) {
      const p: Point | null = segmentIntersection(
        segments[i].start,
        segments[i].end,
        segments[j].start,
        segments[j].end,
      )
      if (p) {
        breakMap[i].push(p)
        breakMap[j].push(p)
      }
    }
  }

  // 3. Deduplicate global vertices, assign ids
  const vertexId = new Map<string, number>()
  const vertices: Vertex[] = []

  function getVertexId(p: Point): number {
    const key = pointKey(p)
    if (!vertexId.has(key)) {
      const id = vertices.length
      vertexId.set(key, id)
      vertices.push(new Vertex(p.x, p.y))
      return id
    }
    return vertexId.get(key)!
  }

  // Sort breakpoint lists along each segment and create sub-edges
  const undirectedEdges: [number, number][] = []
  for (let i = 0; i < segments.length; ++i) {
    const s = segments[i]
    const list: Point[] = breakMap[i].slice()
    // Parametric position t along segment
    list.sort((p1: Point, p2: Point) => {
      const dx = s.end.x - s.start.x
      const dy = s.end.y - s.start.y
      const t1 = almostEqual(Math.abs(dx), 0)
        ? (p1.y - s.start.y) / dy
        : (p1.x - s.start.x) / dx
      const t2 = almostEqual(Math.abs(dx), 0)
        ? (p2.y - s.start.y) / dy
        : (p2.x - s.start.x) / dx
      return t1 - t2
    })
    for (let k = 0; k < list.length - 1; ++k) {
      const p1 = list[k]
      const p2 = list[k + 1]
      const v1 = getVertexId(p1)
      const v2 = getVertexId(p2)

      if (v1 !== v2) {
        undirectedEdges.push([v1, v2])
        // Associate connectionName with the vertices of this sub-segment
        if (s.connectionName) {
          vertices[v1].connectionNames.add(s.connectionName)
          vertices[v2].connectionNames.add(s.connectionName)
        }
      }
    }
  }

  // 4. Build half-edges
  const halfEdges: HalfEdge[] = []
  for (const [v1, v2] of undirectedEdges) {
    const he1 = new HalfEdge(v1, v2)
    const he2 = new HalfEdge(v2, v1)
    he1.twin = halfEdges.length + 1
    he2.twin = halfEdges.length
    const id1 = halfEdges.length
    halfEdges.push(he1, he2)
    // Push to vertex outgoing
    vertices[v1].out.push(id1)
    vertices[v2].out.push(id1 + 1)
  }

  // 5. Sort outgoing edges CCW around each vertex & set next pointers
  for (let vid = 0; vid < vertices.length; ++vid) {
    const v = vertices[vid]
    v.out.sort((e1Idx: number, e2Idx: number) => {
      const e1 = halfEdges[e1Idx]
      const e2 = halfEdges[e2Idx]
      const d1 = vertices[e1.dest]
      const d2 = vertices[e2.dest]
      const a1 = Math.atan2(d1.y - v.y, d1.x - v.x)
      const a2 = Math.atan2(d2.y - v.y, d2.x - v.x)
      return a1 - a2
    })
    const m = v.out.length
    for (let i = 0; i < m; ++i) {
      const heOutIdx = v.out[i]
      const hePrevIdx = v.out[(i - 1 + m) % m] // CW predecessor
      const heOut = halfEdges[heOutIdx]
      if (heOut.twin !== null) {
        halfEdges[heOut.twin].next = hePrevIdx // twin.next = CW-prev to keep left face on our left
      }
    }
  }

  // 6. Walk faces and compute centroids
  const centroids: Point[] = []
  const faces: Face[] = []

  for (let h = 0; h < halfEdges.length; ++h) {
    if (halfEdges[h].visited) continue
    let walk: number | null = h
    const poly: Vertex[] = []
    const faceEdges: number[] = []

    do {
      if (walk === null) break // Should not happen in a well-formed DCEL
      const currentEdge: any = halfEdges[walk]
      currentEdge.visited = true
      poly.push(vertices[currentEdge.orig])
      faceEdges.push(walk)
      walk = currentEdge.next
    } while (walk !== null && walk !== h && !halfEdges[walk].visited)

    if (poly.length < 3) continue

    const area = polygonArea(poly)
    if (area > EPS) {
      const c = polygonCentroid(poly)
      if (c) {
        centroids.push(c)
        faces.push({
          vertices: poly.map((v) => ({
            x: v.x,
            y: v.y,
            connectionNames:
              v.connectionNames.size > 0 ? v.connectionNames : undefined,
          })),
          centroid: c,
        })
      }
    }
  }

  return { centroids, faces, allVertices: vertices }
}
