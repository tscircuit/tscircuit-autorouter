import type { Bounds } from "@tscircuit/math-utils"
import { MHPoint, PolyLine } from "./types1" // Assuming types1 has the necessary definitions

// Re-use or adapt geometric primitives (Point, Segment, intersection, etc.)
// For brevity, assuming similar primitives as in getCentroidsFromInnerBoxIntersections
// or getNumberOfClosedFaces are available or defined here/imported.

interface Point {
  x: number
  y: number
}

interface Segment {
  start: Point
  end: Point
  connectionName: string | null // null for boundary segments
  layer: number
}

// --- Geometric Primitives (Simplified - Adapt from existing utils) ---

const EPS = 1e-9

function almostEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < EPS
}

function pointKey(p: Point): string {
  return `${Math.round(p.x / EPS)}:${Math.round(p.y / EPS)}`
}

function cross(ax: number, ay: number, bx: number, by: number): number {
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

  if (almostEqual(rxs, 0)) {
    // Collinear or parallel
    // Check for overlap if collinear - Simplified: returning null for now
    // A robust implementation would handle collinear overlaps.
    return null
  }

  const t = cross(qp.x, qp.y, s.x, s.y) / rxs
  const u = cross(qp.x, qp.y, r.x, r.y) / rxs

  if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) {
    // Intersection point is within both segments
    return { x: p1.x + t * r.x, y: p1.y + t * r.y }
  }

  return null // Intersection point is not on segments
}

function isOnSegment(p: Point, a: Point, b: Point): boolean {
  const d_ap = Math.hypot(p.x - a.x, p.y - a.y)
  const d_pb = Math.hypot(p.x - b.x, p.y - b.y)
  const d_ab = Math.hypot(a.x - b.x, a.y - b.y)
  return almostEqual(d_ap + d_pb, d_ab)
}

// --- DCEL-like Structures ---

interface DcelVertex extends Point {
  id: number
  isVia: boolean
  connectionNames: Set<string> // Connections passing through this vertex (esp. for endpoints/vias)
  outgoingEdges: DcelHalfEdge[] // Sorted CCW
}

interface DcelHalfEdge {
  id: number
  origin: DcelVertex
  twin: DcelHalfEdge | null
  next: DcelHalfEdge | null
  face: DcelFace | null
  connectionName: string | null // From original segment
  layer: number // From original segment
  visited: boolean // For face traversal
}

interface DcelFace {
  id: number
  outerComponent: DcelHalfEdge | null // One edge on the outer boundary
  innerComponents: DcelHalfEdge[] // Edges bounding holes (if any) - not strictly needed for this check
  isOuterFace: boolean
}

// --- Main Detection Function ---

export function detectMultiConnectionClosedFacesWithoutVias(
  polyLines: PolyLine[],
  bounds: Bounds,
): boolean {
  const allSegments: Segment[] = []
  const viaPoints = new Map<
    string,
    { point: MHPoint; connectionName: string }
  >() // key: pointKey(via)

  // 1. Extract segments from polylines and identify vias
  for (const polyLine of polyLines) {
    const path = [polyLine.start, ...polyLine.mPoints, polyLine.end]
    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i]
      const p2 = path[i + 1]
      const layer = p1.z2 // Layer of the segment

      // Add segment
      allSegments.push({
        start: { x: p1.x, y: p1.y },
        end: { x: p2.x, y: p2.y },
        connectionName: polyLine.connectionName,
        layer: layer,
      })

      // Check and store vias (using p1 as the reference point for the via)
      if (p1.z1 !== p1.z2) {
        const key = pointKey(p1)
        if (!viaPoints.has(key)) {
          viaPoints.set(key, {
            point: p1,
            connectionName: polyLine.connectionName,
          })
        }
      }
    }
    // Check the last point in the path as well
    const lastPoint = path[path.length - 1]
    if (lastPoint.z1 !== lastPoint.z2) {
      const key = pointKey(lastPoint)
      if (!viaPoints.has(key)) {
        viaPoints.set(key, {
          point: lastPoint,
          connectionName: polyLine.connectionName,
        })
      }
    }
  }

  // 2. Add boundary segments (assuming layer 0, adjust if needed)
  // Assign a special connectionName (e.g., null or "__boundary__")
  const boundaryLayer = 0 // Or determine based on context if necessary
  const boundarySegments: Segment[] = [
    {
      start: { x: bounds.minX, y: bounds.minY },
      end: { x: bounds.maxX, y: bounds.minY },
      connectionName: null,
      layer: boundaryLayer,
    },
    {
      start: { x: bounds.maxX, y: bounds.minY },
      end: { x: bounds.maxX, y: bounds.maxY },
      connectionName: null,
      layer: boundaryLayer,
    },
    {
      start: { x: bounds.maxX, y: bounds.maxY },
      end: { x: bounds.minX, y: bounds.maxY },
      connectionName: null,
      layer: boundaryLayer,
    },
    {
      start: { x: bounds.minX, y: bounds.maxY },
      end: { x: bounds.minX, y: bounds.minY },
      connectionName: null,
      layer: boundaryLayer,
    },
  ]
  allSegments.push(...boundarySegments)

  // 3. Find all vertices (endpoints and intersections)
  const verticesMap = new Map<string, DcelVertex>()
  let vertexIdCounter = 0

  function getOrCreateVertex(
    p: Point,
    connectionName?: string | null,
  ): DcelVertex {
    const key = pointKey(p)
    let vertex = verticesMap.get(key)
    if (!vertex) {
      const isVia = viaPoints.has(key)
      vertex = {
        id: vertexIdCounter++,
        x: p.x,
        y: p.y,
        isVia: isVia,
        connectionNames: new Set(),
        outgoingEdges: [],
      }
      verticesMap.set(key, vertex)
      if (isVia && viaPoints.get(key)) {
        vertex.connectionNames.add(viaPoints.get(key)!.connectionName)
      }
    }
    // Add connection name if provided (e.g., for original endpoints)
    if (connectionName) {
      vertex.connectionNames.add(connectionName)
    }
    return vertex
  }

  // Add original endpoints
  for (const seg of allSegments) {
    getOrCreateVertex(seg.start, seg.connectionName)
    getOrCreateVertex(seg.end, seg.connectionName)
  }

  // Find and add intersection points
  const segmentBreakpoints = new Map<Segment, Point[]>()
  // Initialize the map for all segments first
  for (const segment of allSegments) {
    segmentBreakpoints.set(segment, [])
  }

  for (let i = 0; i < allSegments.length; i++) {
    // The entry for allSegments[i] is already initialized above
    for (let j = i + 1; j < allSegments.length; j++) {
      // Only intersect segments on the same layer
      if (allSegments[i].layer !== allSegments[j].layer) continue

      const intersection = segmentIntersection(
        allSegments[i].start,
        allSegments[i].end,
        allSegments[j].start,
        allSegments[j].end,
      )

      if (intersection) {
        getOrCreateVertex(intersection) // Create vertex for intersection
        // Store intersection point relative to both segments for splitting later
        if (
          isOnSegment(intersection, allSegments[i].start, allSegments[i].end)
        ) {
          segmentBreakpoints.get(allSegments[i])!.push(intersection)
        }
        if (
          isOnSegment(intersection, allSegments[j].start, allSegments[j].end)
        ) {
          segmentBreakpoints.get(allSegments[j])!.push(intersection)
        }
      }
    }
  }

  // 4. Create Half-Edges from split segments
  const halfEdges: DcelHalfEdge[] = []
  let edgeIdCounter = 0

  for (const segment of allSegments) {
    const pointsOnSegment = [
      segment.start,
      ...segmentBreakpoints.get(segment)!,
      segment.end,
    ]

    // Sort points along the segment
    pointsOnSegment.sort((a, b) => {
      const dx = segment.end.x - segment.start.x
      const dy = segment.end.y - segment.start.y
      if (Math.abs(dx) > Math.abs(dy)) {
        // Sort primarily by x
        return (a.x - segment.start.x) / dx - (b.x - segment.start.x) / dx
      } else {
        // Sort primarily by y
        // Avoid division by zero if dy is small
        return Math.abs(dy) < EPS
          ? 0
          : (a.y - segment.start.y) / dy - (b.y - segment.start.y) / dy
      }
    })

    // Deduplicate points (intersections might be very close to endpoints)
    const uniquePoints: Point[] = []
    if (pointsOnSegment.length > 0) {
      uniquePoints.push(pointsOnSegment[0])
      for (let i = 1; i < pointsOnSegment.length; i++) {
        if (
          !almostEqual(pointsOnSegment[i].x, pointsOnSegment[i - 1].x) ||
          !almostEqual(pointsOnSegment[i].y, pointsOnSegment[i - 1].y)
        ) {
          uniquePoints.push(pointsOnSegment[i])
        }
      }
    }

    // Create half-edges for each sub-segment
    for (let i = 0; i < uniquePoints.length - 1; i++) {
      const p1 = uniquePoints[i]
      const p2 = uniquePoints[i + 1]
      const v1 = getOrCreateVertex(p1, segment.connectionName)
      const v2 = getOrCreateVertex(p2, segment.connectionName)

      // Avoid creating zero-length edges
      if (v1 === v2) continue

      const edge1: DcelHalfEdge = {
        id: edgeIdCounter++,
        origin: v1,
        twin: null, // Will be set later
        next: null, // Will be set later
        face: null, // Will be set later
        connectionName: segment.connectionName,
        layer: segment.layer,
        visited: false,
      }
      const edge2: DcelHalfEdge = {
        id: edgeIdCounter++,
        origin: v2,
        twin: edge1,
        next: null,
        face: null,
        connectionName: segment.connectionName, // Twin carries same info
        layer: segment.layer,
        visited: false,
      }
      edge1.twin = edge2

      halfEdges.push(edge1, edge2)
      v1.outgoingEdges.push(edge1)
      v2.outgoingEdges.push(edge2)
    }
  }

  // 5. Link Half-Edges (Sort outgoing edges CCW and set `next` pointers)
  for (const vertex of verticesMap.values()) {
    vertex.outgoingEdges.sort((e1, e2) => {
      const p1 = e1.twin!.origin // Destination of e1
      const p2 = e2.twin!.origin // Destination of e2
      const angle1 = Math.atan2(p1.y - vertex.y, p1.x - vertex.x)
      const angle2 = Math.atan2(p2.y - vertex.y, p2.x - vertex.x)
      return angle1 - angle2
    })

    // Set next pointers: e.twin.next = prev_edge
    const numEdges = vertex.outgoingEdges.length
    for (let i = 0; i < numEdges; i++) {
      const currentEdge = vertex.outgoingEdges[i]
      const prevEdge = vertex.outgoingEdges[(i - 1 + numEdges) % numEdges] // Edge arriving CW before currentEdge
      // The 'next' edge in the face cycle starting from currentEdge.twin's origin is prevEdge
      if (currentEdge.twin) {
        currentEdge.twin.next = prevEdge
      }
    }
  }

  // 6. Traverse Faces and Check Conditions
  const faces: DcelFace[] = []
  let faceIdCounter = 0
  let outerFace: DcelFace | null = null
  let maxArea = -Infinity

  for (const edge of halfEdges) {
    if (edge.visited) continue

    const face: DcelFace = {
      id: faceIdCounter++,
      outerComponent: edge,
      innerComponents: [],
      isOuterFace: false, // Assume internal first
    }
    faces.push(face)

    let currentEdge: DcelHalfEdge | null = edge
    const faceEdges: DcelHalfEdge[] = []
    const faceVertices: DcelVertex[] = []
    const faceConnectionNames = new Set<string | null>()
    let faceArea = 0

    do {
      if (!currentEdge || currentEdge.visited) {
        // This might happen with malformed geometry or complex overlaps
        console.warn(
          "Face traversal encountered visited edge or null, breaking loop.",
          face.id,
        )
        // Resetting faceEdges to prevent partial face analysis
        faceEdges.length = 0
        break
      }
      currentEdge.visited = true
      currentEdge.face = face
      faceEdges.push(currentEdge)
      faceVertices.push(currentEdge.origin)
      if (currentEdge.connectionName !== null) {
        // Exclude boundary connection name
        faceConnectionNames.add(currentEdge.connectionName)
      }

      // Area calculation (Shoelace formula)
      const p1 = currentEdge.origin
      const p2 = currentEdge.twin!.origin
      faceArea += p1.x * p2.y - p2.x * p1.y

      currentEdge = currentEdge.next
    } while (currentEdge !== edge && currentEdge !== null)

    // Check if the loop closed properly
    if (currentEdge !== edge) {
      // Loop didn't close, likely due to geometric issues or incomplete DCEL linking.
      // Mark this face as potentially problematic or discard it.
      console.warn(`Face ${face.id} did not close properly.`)
      // Optionally remove the face or mark it invalid
      faces.pop() // Remove the incomplete face
      faceIdCounter--
      // Backtrack visited flags? This can be complex. Simpler to log and potentially ignore.
      continue // Skip analysis for this incomplete face
    }

    faceArea = 0.5 * Math.abs(faceArea)

    // Identify outer face (largest area)
    if (faceArea > maxArea) {
      maxArea = faceArea
      if (outerFace) outerFace.isOuterFace = false // Demote previous outer face
      outerFace = face
      face.isOuterFace = true
    }

    // --- Condition Check for Internal Faces ---
    if (!face.isOuterFace && faceEdges.length > 0) {
      // Ensure face is valid and internal
      // Check 1: Does the face involve multiple non-boundary connections?
      // Note: All edges in a valid face should be on the same layer due to the intersection logic.
      const actualConnectionNames = [...faceConnectionNames].filter(
        (name) => name !== null,
      )

      if (actualConnectionNames.length > 1) {
        // Check 2: Is ANY vertex on this face's boundary a via?
        let viaFoundOnFace = false
        for (const vertex of faceVertices) {
          if (vertex.isVia) {
            viaFoundOnFace = true
            break // Found a via on the boundary, this face is potentially valid
          }
        }

        // If multiple connections form the face AND NO via was found on its boundary...
        if (!viaFoundOnFace) {
          // This configuration is invalid because multiple nets form a closed loop
          // on the same layer without a via allowing a layer change.
          // console.log(`Detected multi-connection face (ID: ${face.id}, Connections: ${actualConnectionNames.join(', ')}) on layer ${faceEdges[0]?.layer} without any vias on its boundary.`)
          return true // Found the problematic configuration
        }
      }
    }
  }

  // If we finish traversing all faces without returning true, the condition was not met
  return false
}
