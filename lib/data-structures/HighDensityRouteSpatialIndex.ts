import { doSegmentsIntersect } from "@tscircuit/math-utils" // Assuming this is available and correct
import type { Jumper } from "lib/types/high-density-types"

// --- Interfaces and Types (Unchanged) ---

interface Point {
  x: number
  y: number
  z: number // Kept for type compatibility, but calculations focus on X/Y
}

type Point2D = { x: number; y: number } // Use Point2D for clarity in calculations

type Segment = [Point, Point]

export type HighDensityIntraNodeRoute = {
  connectionName: string // Assuming this is unique per route
  rootConnectionName?: string // Parent connection for merged routes
  traceThickness: number
  viaDiameter: number // Now used in conflict calculation
  route: Array<{ x: number; y: number; z: number }>
  vias: Array<{ x: number; y: number }> // Will be indexed
  jumpers?: Jumper[]
}
export type HighDensityRoute = HighDensityIntraNodeRoute

// --- Utility Functions (Unchanged) ---

const getSegmentBounds = (segment: Segment) => {
  return {
    minX: Math.min(segment[0].x, segment[1].x),
    maxX: Math.max(segment[0].x, segment[1].x),
    minY: Math.min(segment[0].y, segment[1].y),
    maxY: Math.max(segment[0].y, segment[1].y),
  }
}

export type BucketCoordinate = `${number}x${number}`

// --- Geometry Helper Functions (Unchanged, but ensure Point2D compatibility) ---

function computeDistSq(p1: Point2D, p2: Point2D): number {
  const dx = p1.x - p2.x
  const dy = p1.y - p2.y
  return dx * dx + dy * dy
}

function pointToSegmentDistanceSq(p: Point2D, a: Point2D, b: Point2D): number {
  const l2 = computeDistSq(a, b)
  if (l2 === 0) return computeDistSq(p, a) // Segment is a point
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2
  t = Math.max(0, Math.min(1, t))
  const projection = {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y),
  }
  return computeDistSq(p, projection)
}

function segmentToSegmentDistanceSq(
  a: Point, // Keep Point for compatibility if doSegmentsIntersect needs z
  b: Point,
  c: Point,
  d: Point,
): number {
  // Use the provided (or assumed imported) intersection function
  if (doSegmentsIntersect(a, b, c, d)) {
    return 0
  }
  // Convert to Point2D for distance calculations
  const pA = { x: a.x, y: a.y }
  const pB = { x: b.x, y: b.y }
  const pC = { x: c.x, y: c.y }
  const pD = { x: d.x, y: d.y }

  return Math.min(
    pointToSegmentDistanceSq(pA, pC, pD),
    pointToSegmentDistanceSq(pB, pC, pD),
    pointToSegmentDistanceSq(pC, pA, pB),
    pointToSegmentDistanceSq(pD, pA, pB),
  )
}

// --- New Interfaces for Bucket Contents ---
interface StoredSegment {
  segmentId: string
  segment: [Point, Point] // Keep original Point type if needed by other parts
  parentRoute: HighDensityRoute
}

interface StoredVia {
  viaId: string // Unique identifier for the via within its route
  x: number
  y: number
  parentRoute: HighDensityRoute
}

// --- Updated Spatial Index Class ---

export class HighDensityRouteSpatialIndex {
  private segmentBuckets: Map<BucketCoordinate, StoredSegment[]>
  private viaBuckets: Map<BucketCoordinate, StoredVia[]> // New: Store vias
  private CELL_SIZE: number

  constructor(routes: HighDensityRoute[], cellSize: number = 1.0) {
    // console.time("HighDensityRouteSpatialIndex Constructor");
    this.segmentBuckets = new Map()
    this.viaBuckets = new Map() // Initialize via buckets
    this.CELL_SIZE = cellSize
    const epsilon = 1e-9 // For segment boundary checks

    for (const route of routes) {
      if (!route || !route.connectionName) {
        console.warn("Skipping route with missing data:", route)
        continue
      }

      // --- Index Segments ---
      if (route.route && route.route.length >= 2) {
        for (let i = 0; i < route.route.length - 1; i++) {
          const p1 = route.route[i]
          const p2 = route.route[i + 1]
          // Skip zero-length segments
          if (p1.x === p2.x && p1.y === p2.y) continue

          const segment: Segment = [p1, p2]
          const bounds = getSegmentBounds(segment)

          const segmentInfo: StoredSegment = {
            segmentId: `${route.connectionName}-seg-${i}`,
            segment: segment,
            parentRoute: route,
          }

          const minIndexX = Math.floor(bounds.minX / this.CELL_SIZE)
          const maxIndexX = Math.floor((bounds.maxX + epsilon) / this.CELL_SIZE)
          const minIndexY = Math.floor(bounds.minY / this.CELL_SIZE)
          const maxIndexY = Math.floor((bounds.maxY + epsilon) / this.CELL_SIZE)

          for (let ix = minIndexX; ix <= maxIndexX; ix++) {
            for (let iy = minIndexY; iy <= maxIndexY; iy++) {
              const bucketKey = `${ix}x${iy}` as BucketCoordinate
              let bucketList = this.segmentBuckets.get(bucketKey)
              if (!bucketList) {
                bucketList = []
                this.segmentBuckets.set(bucketKey, bucketList)
              }
              bucketList.push(segmentInfo)
            }
          }
        }
      }

      // --- Index Vias ---
      if (route.vias && route.vias.length > 0) {
        for (let i = 0; i < route.vias.length; i++) {
          const via = route.vias[i]
          if (via === undefined || via === null) continue // Basic check

          const storedVia: StoredVia = {
            viaId: `${route.connectionName}-via-${i}`,
            x: via.x,
            y: via.y,
            parentRoute: route,
          }

          // Vias belong to a single bucket
          const ix = Math.floor(via.x / this.CELL_SIZE)
          const iy = Math.floor(via.y / this.CELL_SIZE)
          const bucketKey = `${ix}x${iy}` as BucketCoordinate

          let bucketList = this.viaBuckets.get(bucketKey)
          if (!bucketList) {
            bucketList = []
            this.viaBuckets.set(bucketKey, bucketList)
          }
          bucketList.push(storedVia)
        }
      }
    }
    // console.timeEnd("HighDensityRouteSpatialIndex Constructor");
  }

  /**
   * Finds routes that potentially conflict with a given line segment within a margin.
   * Checks both segments and vias.
   * @param segmentStart Start point of the query segment.
   * @param segmentEnd End point of the query segment.
   * @param margin The minimum required clearance distance from the query segment's centerline.
   * @returns An array of conflicting routes and their minimum distance to the segment.
   */
  getConflictingRoutesForSegment(
    segmentStart: Point, // Keep Point for original Z data if needed elsewhere
    segmentEnd: Point,
    margin: number, // Minimum required clearance
  ): Array<{ conflictingRoute: HighDensityRoute; distance: number }> {
    const querySegment: Segment = [segmentStart, segmentEnd]
    const bounds = getSegmentBounds(querySegment)

    // --- Define search area including margin for both segments and vias ---
    // Need to consider the maximum possible radius (trace/2 or via/2) + margin
    // For simplicity, just use the provided margin for bucket search.
    // Precise checks will use item-specific sizes.
    const searchMinX = bounds.minX - margin
    const searchMinY = bounds.minY - margin
    const searchMaxX = bounds.maxX + margin
    const searchMaxY = bounds.maxY + margin
    const epsilon = 1e-9

    const minIndexX = Math.floor(searchMinX / this.CELL_SIZE)
    const maxIndexX = Math.floor((searchMaxX + epsilon) / this.CELL_SIZE)
    const minIndexY = Math.floor(searchMinY / this.CELL_SIZE)
    const maxIndexY = Math.floor((searchMaxY + epsilon) / this.CELL_SIZE)

    // Use a map to store the minimum squared distance found *per route*
    const conflictingRouteData = new Map<
      string,
      { route: HighDensityRoute; minDistSq: number }
    >()
    const checkedSegments = new Set<string>() // Store segmentId
    const checkedVias = new Set<string>() // Store viaId

    const queryP1: Point2D = { x: segmentStart.x, y: segmentStart.y }
    const queryP2: Point2D = { x: segmentEnd.x, y: segmentEnd.y }

    for (let ix = minIndexX; ix <= maxIndexX; ix++) {
      for (let iy = minIndexY; iy <= maxIndexY; iy++) {
        const bucketKey = `${ix}x${iy}` as BucketCoordinate

        // --- Check Segments in Bucket ---
        const segmentBucketList = this.segmentBuckets.get(bucketKey)
        if (segmentBucketList) {
          for (const segmentInfo of segmentBucketList) {
            if (checkedSegments.has(segmentInfo.segmentId)) continue
            checkedSegments.add(segmentInfo.segmentId)

            const route = segmentInfo.parentRoute
            const [p1, p2] = segmentInfo.segment // Original points

            // Required separation distance from query centerline to segment edge
            const requiredSeparation = margin + route.traceThickness / 2
            const requiredSeparationSq = requiredSeparation * requiredSeparation

            // Use original points for segmentToSegmentDistanceSq if it relies on the Point type
            const distSq = segmentToSegmentDistanceSq(
              segmentStart,
              segmentEnd,
              p1,
              p2,
            )

            if (distSq < requiredSeparationSq) {
              // Use < for strict clearance
              const routeName = route.connectionName
              const existing = conflictingRouteData.get(routeName)
              if (!existing || distSq < existing.minDistSq) {
                conflictingRouteData.set(routeName, {
                  route,
                  minDistSq: distSq,
                })
              }
            }
          }
        }

        // --- Check Vias in Bucket ---
        const viaBucketList = this.viaBuckets.get(bucketKey)
        if (viaBucketList) {
          for (const viaInfo of viaBucketList) {
            if (checkedVias.has(viaInfo.viaId)) continue
            checkedVias.add(viaInfo.viaId)

            const route = viaInfo.parentRoute
            const viaPoint: Point2D = { x: viaInfo.x, y: viaInfo.y }

            // Required separation distance from query centerline to via edge
            const requiredSeparation = margin + route.viaDiameter / 2
            const requiredSeparationSq = requiredSeparation * requiredSeparation

            // Calculate distance from via center to the query segment
            const distSq = pointToSegmentDistanceSq(viaPoint, queryP1, queryP2)

            if (distSq < requiredSeparationSq) {
              // Use < for strict clearance
              const routeName = route.connectionName
              const existing = conflictingRouteData.get(routeName)
              if (!existing || distSq < existing.minDistSq) {
                conflictingRouteData.set(routeName, {
                  route,
                  minDistSq: distSq,
                })
              }
            }
          }
        }
      }
    }

    // --- Convert map to results ---
    const results: Array<{
      conflictingRoute: HighDensityRoute
      distance: number
    }> = []
    for (const data of conflictingRouteData.values()) {
      // Distance reported is centerline-to-centerline (or point)
      results.push({
        conflictingRoute: data.route,
        distance: Math.sqrt(data.minDistSq),
      })
    }

    return results
  }

  /**
   * Finds routes that pass near a given point within a margin.
   * Checks both segments and vias.
   * @param point The query point {x, y}. Z is ignored.
   * @param margin The minimum required clearance distance from the query point.
   * @returns An array of conflicting routes and their minimum distance to the point.
   */
  getConflictingRoutesNearPoint(
    point: Point2D,
    margin: number, // Minimum required clearance
  ): Array<{ conflictingRoute: HighDensityRoute; distance: number }> {
    // --- Define search area ---
    const searchMinX = point.x - margin
    const searchMinY = point.y - margin
    const searchMaxX = point.x + margin
    const searchMaxY = point.y + margin
    const epsilon = 1e-9

    const minIndexX = Math.floor(searchMinX / this.CELL_SIZE)
    const maxIndexX = Math.floor((searchMaxX + epsilon) / this.CELL_SIZE) // Epsilon might not be strictly needed for point queries but harmless
    const minIndexY = Math.floor(searchMinY / this.CELL_SIZE)
    const maxIndexY = Math.floor((searchMaxY + epsilon) / this.CELL_SIZE)

    const conflictingRouteData = new Map<
      string,
      { route: HighDensityRoute; minDistSq: number }
    >()
    const checkedSegments = new Set<string>()
    const checkedVias = new Set<string>()

    for (let ix = minIndexX; ix <= maxIndexX; ix++) {
      for (let iy = minIndexY; iy <= maxIndexY; iy++) {
        const bucketKey = `${ix}x${iy}` as BucketCoordinate

        // --- Check Segments ---
        const segmentBucketList = this.segmentBuckets.get(bucketKey)
        if (segmentBucketList) {
          for (const segmentInfo of segmentBucketList) {
            if (checkedSegments.has(segmentInfo.segmentId)) continue
            checkedSegments.add(segmentInfo.segmentId)

            const route = segmentInfo.parentRoute
            // Convert segment points to Point2D for distance calculation
            const p1: Point2D = {
              x: segmentInfo.segment[0].x,
              y: segmentInfo.segment[0].y,
            }
            const p2: Point2D = {
              x: segmentInfo.segment[1].x,
              y: segmentInfo.segment[1].y,
            }

            const requiredSeparation = margin + route.traceThickness / 2
            const requiredSeparationSq = requiredSeparation * requiredSeparation

            const distSq = pointToSegmentDistanceSq(point, p1, p2)

            if (distSq < requiredSeparationSq) {
              // Use < for strict clearance
              const routeName = route.connectionName
              const existing = conflictingRouteData.get(routeName)
              if (!existing || distSq < existing.minDistSq) {
                conflictingRouteData.set(routeName, {
                  route,
                  minDistSq: distSq,
                })
              }
            }
          }
        }

        // --- Check Vias ---
        const viaBucketList = this.viaBuckets.get(bucketKey)
        if (viaBucketList) {
          for (const viaInfo of viaBucketList) {
            if (checkedVias.has(viaInfo.viaId)) continue
            checkedVias.add(viaInfo.viaId)

            const route = viaInfo.parentRoute
            const viaPoint: Point2D = { x: viaInfo.x, y: viaInfo.y }

            const requiredSeparation = margin + route.viaDiameter / 2
            const requiredSeparationSq = requiredSeparation * requiredSeparation

            const distSq = computeDistSq(point, viaPoint) // Point-to-point distance

            if (distSq < requiredSeparationSq) {
              // Use < for strict clearance
              const routeName = route.connectionName
              const existing = conflictingRouteData.get(routeName)
              if (!existing || distSq < existing.minDistSq) {
                conflictingRouteData.set(routeName, {
                  route,
                  minDistSq: distSq,
                })
              }
            }
          }
        }
      }
    }

    // --- Convert map to results ---
    const results: Array<{
      conflictingRoute: HighDensityRoute
      distance: number
    }> = []
    for (const data of conflictingRouteData.values()) {
      // Distance reported is point-to-segment-centerline or point-to-via-center
      results.push({
        conflictingRoute: data.route,
        distance: Math.sqrt(data.minDistSq),
      })
    }

    return results
  }
}
