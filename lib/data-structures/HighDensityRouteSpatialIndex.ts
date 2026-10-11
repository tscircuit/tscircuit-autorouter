import { doSegmentsIntersect, Point3 } from "@tscircuit/math-utils" // Assuming this is available and correct
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
  route: Array<{ x: number; y: number; z: number; insideJumperPad?: boolean }>
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
  const dx = p.x - (a.x + t * (b.x - a.x))
  const dy = p.y - (a.y + t * (b.y - a.y))
  return dx * dx + dy * dy
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
  return Math.min(
    pointToSegmentDistanceSq(a, c, d),
    pointToSegmentDistanceSq(b, c, d),
    pointToSegmentDistanceSq(c, a, b),
    pointToSegmentDistanceSq(d, a, b),
  )
}

// --- New Interfaces for Bucket Contents ---
interface QueryMarker {
  lastQuery: number
  indexedItemCount: number
}

interface StoredSegment {
  segmentId: string
  queryMarker: QueryMarker
  segment: [Point, Point] // Keep original Point type if needed by other parts
  parentRoute: HighDensityRoute
}

interface StoredVia {
  viaId: string // Unique identifier for the via within its route
  queryMarker: QueryMarker
  x: number
  y: number
  parentRoute: HighDensityRoute
}

// --- Updated Spatial Index Class ---

export class HighDensityRouteSpatialIndex {
  private segmentBuckets: Map<BucketCoordinate, StoredSegment[]>
  private viaBuckets: Map<BucketCoordinate, StoredVia[]> // New: Store vias
  // Reuse the same bucket arrays under numeric column coordinates. Queries
  // visit many empty cells, so avoid allocating a coordinate string for each
  // one. The original bucket maps retain insertion and removal order.
  private segmentColumns = new Map<number, Map<number, StoredSegment[]>>()
  private viaColumns = new Map<number, Map<number, StoredVia[]>>()
  private CELL_SIZE: number
  private maximumCopperRadius = 0
  // Keep the original string-ID deduplication semantics, including routes that
  // share a connection name. Bucket entries with the same ID share a marker.
  // Stamping those markers avoids allocating and hashing two Sets per query.
  private segmentQueryMarkers = new Map<string, QueryMarker>()
  private viaQueryMarkers = new Map<string, QueryMarker>()
  private queryNumber = 0

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
      this.maximumCopperRadius = Math.max(
        this.maximumCopperRadius,
        route.traceThickness / 2,
        route.viaDiameter / 2,
      )

      // --- Index Segments ---
      if (route.route && route.route.length >= 2) {
        for (let i = 0; i < route.route.length - 1; i++) {
          const p1 = route.route[i]
          const p2 = route.route[i + 1]
          // Skip zero-length segments
          if (p1.x === p2.x && p1.y === p2.y) continue
          // Skip segments inside jumper pads (jumper wires are not collidable)
          if (p1.insideJumperPad && p2.insideJumperPad) continue

          const segment: Segment = [p1, p2]
          const bounds = getSegmentBounds(segment)

          const segmentId = `${route.connectionName}-seg-${i}`
          const segmentInfo: StoredSegment = {
            segmentId,
            queryMarker: this.getQueryMarker(this.segmentQueryMarkers, segmentId),
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
                let column = this.segmentColumns.get(ix)
                if (!column) {
                  column = new Map()
                  this.segmentColumns.set(ix, column)
                }
                column.set(iy, bucketList)
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

          const viaId = `${route.connectionName}-via-${i}`
          const storedVia: StoredVia = {
            viaId,
            queryMarker: this.getQueryMarker(this.viaQueryMarkers, viaId),
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
            let column = this.viaColumns.get(ix)
            if (!column) {
              column = new Map()
              this.viaColumns.set(ix, column)
            }
            column.set(iy, bucketList)
          }
          bucketList.push(storedVia)
        }
      }
    }
    // console.timeEnd("HighDensityRouteSpatialIndex Constructor");
  }

  private getQueryMarker(
    markers: Map<string, QueryMarker>,
    id: string,
  ): QueryMarker {
    let marker = markers.get(id)
    if (!marker) {
      marker = { lastQuery: 0, indexedItemCount: 0 }
      markers.set(id, marker)
    }
    marker.indexedItemCount++
    return marker
  }

  private startQuery(): number {
    if (this.queryNumber === Number.MAX_SAFE_INTEGER) {
      for (const marker of this.segmentQueryMarkers.values()) marker.lastQuery = 0
      for (const marker of this.viaQueryMarkers.values()) marker.lastQuery = 0
      this.queryNumber = 0
    }
    return ++this.queryNumber
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
    // Stored centerlines can sit in a neighboring bucket while their copper
    // still reaches the query margin. Expand by the largest indexed copper
    // radius; item-specific checks below retain the exact separation test.
    const broadPhaseMargin = margin + this.maximumCopperRadius
    const searchMinX = bounds.minX - broadPhaseMargin
    const searchMinY = bounds.minY - broadPhaseMargin
    const searchMaxX = bounds.maxX + broadPhaseMargin
    const searchMaxY = bounds.maxY + broadPhaseMargin
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
    const queryNumber = this.startQuery()

    for (let ix = minIndexX; ix <= maxIndexX; ix++) {
      const segmentColumn = this.segmentColumns.get(ix)
      const viaColumn = this.viaColumns.get(ix)
      if (!segmentColumn && !viaColumn) continue
      for (let iy = minIndexY; iy <= maxIndexY; iy++) {
        // --- Check Segments in Bucket ---
        const segmentBucketList = segmentColumn?.get(iy)
        if (segmentBucketList) {
          for (const segmentInfo of segmentBucketList) {
            if (segmentInfo.queryMarker.lastQuery === queryNumber) continue
            segmentInfo.queryMarker.lastQuery = queryNumber

            const route = segmentInfo.parentRoute
            const [p1, p2] = segmentInfo.segment // Original points

            // Copper traces only conflict on the same layer. Vias are checked
            // separately below because they span every layer they connect.
            if (
              segmentStart.z !== segmentEnd.z ||
              p1.z !== p2.z ||
              p1.z !== segmentStart.z
            ) {
              continue
            }

            // Required separation distance from query centerline to segment edge
            const requiredSeparation = margin + route.traceThickness / 2
            const requiredSeparationSq = requiredSeparation * requiredSeparation
            // Buckets are deliberately coarse. Reject an axis-separated
            // centerline before computing four projections and intersections.
            // Read current endpoints because callers can edit indexed points.
            const axisMargin = Math.abs(requiredSeparation) + epsilon
            if (
              Math.max(p1.x, p2.x) + axisMargin < bounds.minX ||
              Math.min(p1.x, p2.x) - axisMargin > bounds.maxX ||
              Math.max(p1.y, p2.y) + axisMargin < bounds.minY ||
              Math.min(p1.y, p2.y) - axisMargin > bounds.maxY
            ) continue

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
              if (!existing) {
                conflictingRouteData.set(routeName, { route, minDistSq: distSq })
              } else if (distSq < existing.minDistSq) {
                existing.route = route
                existing.minDistSq = distSq
              }
            }
          }
        }

        // --- Check Vias in Bucket ---
        const viaBucketList = viaColumn?.get(iy)
        if (viaBucketList) {
          for (const viaInfo of viaBucketList) {
            if (viaInfo.queryMarker.lastQuery === queryNumber) continue
            viaInfo.queryMarker.lastQuery = queryNumber

            const route = viaInfo.parentRoute

            // Required separation distance from query centerline to via edge
            const requiredSeparation = margin + route.viaDiameter / 2
            const requiredSeparationSq = requiredSeparation * requiredSeparation

            // Calculate distance from via center to the query segment
            const distSq = pointToSegmentDistanceSq(viaInfo, segmentStart, segmentEnd)

            if (distSq < requiredSeparationSq) {
              // Use < for strict clearance
              const routeName = route.connectionName
              const existing = conflictingRouteData.get(routeName)
              if (!existing) {
                conflictingRouteData.set(routeName, { route, minDistSq: distSq })
              } else if (distSq < existing.minDistSq) {
                existing.route = route
                existing.minDistSq = distSq
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
   * Removes a route from the spatial index by connection name.
   * @param connectionName The connection name of the route to remove.
   */
  removeRoute(connectionName: string): void {
    // Remove segments belonging to this route
    const removedSegments = new Set<StoredSegment>()
    for (const [bucketKey, segments] of this.segmentBuckets) {
      const filtered = segments.filter((seg) => {
        if (seg.parentRoute.connectionName !== connectionName) return true
        removedSegments.add(seg)
        return false
      })
      if (filtered.length === 0) {
        this.segmentBuckets.delete(bucketKey)
        const [ix, iy] = bucketKey.split("x").map(Number)
        const column = this.segmentColumns.get(ix!)!
        column.delete(iy!)
        if (column.size === 0) this.segmentColumns.delete(ix!)
      } else if (filtered.length !== segments.length) {
        this.segmentBuckets.set(bucketKey, filtered)
        const [ix, iy] = bucketKey.split("x").map(Number)
        this.segmentColumns.get(ix!)!.set(iy!, filtered)
      }
    }
    for (const segment of removedSegments) {
      if (--segment.queryMarker.indexedItemCount === 0) {
        this.segmentQueryMarkers.delete(segment.segmentId)
      }
    }

    // Remove vias belonging to this route
    for (const [bucketKey, vias] of this.viaBuckets) {
      const filtered = vias.filter((via) => {
        if (via.parentRoute.connectionName !== connectionName) return true
        if (--via.queryMarker.indexedItemCount === 0) {
          this.viaQueryMarkers.delete(via.viaId)
        }
        return false
      })
      if (filtered.length === 0) {
        this.viaBuckets.delete(bucketKey)
        const [ix, iy] = bucketKey.split("x").map(Number)
        const column = this.viaColumns.get(ix!)!
        column.delete(iy!)
        if (column.size === 0) this.viaColumns.delete(ix!)
      } else if (filtered.length !== vias.length) {
        this.viaBuckets.set(bucketKey, filtered)
        const [ix, iy] = bucketKey.split("x").map(Number)
        this.viaColumns.get(ix!)!.set(iy!, filtered)
      }
    }
  }

  /**
   * Adds a single route to the spatial index.
   * @param route The route to add.
   */
  addRoute(route: HighDensityRoute): void {
    if (!route || !route.connectionName) {
      console.warn("Skipping route with missing data:", route)
      return
    }
    this.maximumCopperRadius = Math.max(
      this.maximumCopperRadius,
      route.traceThickness / 2,
      route.viaDiameter / 2,
    )

    const epsilon = 1e-9

    // --- Index Segments ---
    if (route.route && route.route.length >= 2) {
      for (let i = 0; i < route.route.length - 1; i++) {
        const p1 = route.route[i]
        const p2 = route.route[i + 1]
        // Skip zero-length segments
        if (p1.x === p2.x && p1.y === p2.y) continue
        // Skip segments inside jumper pads (jumper wires are not collidable)
        if (p1.insideJumperPad && p2.insideJumperPad) continue

        const segment: Segment = [p1, p2]
        const bounds = getSegmentBounds(segment)

        const segmentId = `${route.connectionName}-seg-${i}`
        const segmentInfo: StoredSegment = {
          segmentId,
          queryMarker: this.getQueryMarker(this.segmentQueryMarkers, segmentId),
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
              let column = this.segmentColumns.get(ix)
              if (!column) {
                column = new Map()
                this.segmentColumns.set(ix, column)
              }
              column.set(iy, bucketList)
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
        if (via === undefined || via === null) continue

        const viaId = `${route.connectionName}-via-${i}`
        const storedVia: StoredVia = {
          viaId,
          queryMarker: this.getQueryMarker(this.viaQueryMarkers, viaId),
          x: via.x,
          y: via.y,
          parentRoute: route,
        }

        const ix = Math.floor(via.x / this.CELL_SIZE)
        const iy = Math.floor(via.y / this.CELL_SIZE)
        const bucketKey = `${ix}x${iy}` as BucketCoordinate

        let bucketList = this.viaBuckets.get(bucketKey)
        if (!bucketList) {
          bucketList = []
          this.viaBuckets.set(bucketKey, bucketList)
          let column = this.viaColumns.get(ix)
          if (!column) {
            column = new Map()
            this.viaColumns.set(ix, column)
          }
          column.set(iy, bucketList)
        }
        bucketList.push(storedVia)
      }
    }
  }

  /**
   * Finds routes that pass near a given point within a margin.
   * Checks both segments and vias.
   * @param point The query point {x, y, z}.
   * @param margin The minimum required clearance distance from the query point.
   * @returns An array of conflicting routes and their minimum distance to the point.
   */
  getConflictingRoutesNearPoint(
    point: Point3,
    margin: number, // Minimum required clearance
  ): Array<{ conflictingRoute: HighDensityRoute; distance: number }> {
    // --- Define search area ---
    const broadPhaseMargin = margin + this.maximumCopperRadius
    const searchMinX = point.x - broadPhaseMargin
    const searchMinY = point.y - broadPhaseMargin
    const searchMaxX = point.x + broadPhaseMargin
    const searchMaxY = point.y + broadPhaseMargin
    const epsilon = 1e-9

    const minIndexX = Math.floor(searchMinX / this.CELL_SIZE)
    const maxIndexX = Math.floor((searchMaxX + epsilon) / this.CELL_SIZE) // Epsilon might not be strictly needed for point queries but harmless
    const minIndexY = Math.floor(searchMinY / this.CELL_SIZE)
    const maxIndexY = Math.floor((searchMaxY + epsilon) / this.CELL_SIZE)

    const conflictingRouteData = new Map<
      string,
      { route: HighDensityRoute; minDistSq: number }
    >()
    const queryNumber = this.startQuery()

    for (let ix = minIndexX; ix <= maxIndexX; ix++) {
      const segmentColumn = this.segmentColumns.get(ix)
      const viaColumn = this.viaColumns.get(ix)
      if (!segmentColumn && !viaColumn) continue
      for (let iy = minIndexY; iy <= maxIndexY; iy++) {
        // --- Check Segments ---
        const segmentBucketList = segmentColumn?.get(iy)
        if (segmentBucketList) {
          for (const segmentInfo of segmentBucketList) {
            if (segmentInfo.queryMarker.lastQuery === queryNumber) continue
            segmentInfo.queryMarker.lastQuery = queryNumber

            const p1_seg = segmentInfo.segment[0]
            const p2_seg = segmentInfo.segment[1]
            if (p1_seg.z !== p2_seg.z || p1_seg.z !== point.z) {
              continue
            }

            const route = segmentInfo.parentRoute
            const requiredSeparation = margin + route.traceThickness / 2
            const requiredSeparationSq = requiredSeparation * requiredSeparation
            const axisMargin = Math.abs(requiredSeparation) + epsilon
            if (
              Math.max(p1_seg.x, p2_seg.x) + axisMargin < point.x ||
              Math.min(p1_seg.x, p2_seg.x) - axisMargin > point.x ||
              Math.max(p1_seg.y, p2_seg.y) + axisMargin < point.y ||
              Math.min(p1_seg.y, p2_seg.y) - axisMargin > point.y
            ) continue

            const distSq = pointToSegmentDistanceSq(point, p1_seg, p2_seg)

            if (distSq < requiredSeparationSq) {
              // Use < for strict clearance
              const routeName = route.connectionName
              const existing = conflictingRouteData.get(routeName)
              if (!existing) {
                conflictingRouteData.set(routeName, { route, minDistSq: distSq })
              } else if (distSq < existing.minDistSq) {
                existing.route = route
                existing.minDistSq = distSq
              }
            }
          }
        }

        // --- Check Vias ---
        const viaBucketList = viaColumn?.get(iy)
        if (viaBucketList) {
          for (const viaInfo of viaBucketList) {
            if (viaInfo.queryMarker.lastQuery === queryNumber) continue
            viaInfo.queryMarker.lastQuery = queryNumber

            const route = viaInfo.parentRoute

            const requiredSeparation = margin + route.viaDiameter / 2
            const requiredSeparationSq = requiredSeparation * requiredSeparation

            const distSq = computeDistSq(point, viaInfo) // Point-to-point distance

            if (distSq < requiredSeparationSq) {
              // Use < for strict clearance
              const routeName = route.connectionName
              const existing = conflictingRouteData.get(routeName)
              if (!existing) {
                conflictingRouteData.set(routeName, { route, minDistSq: distSq })
              } else if (distSq < existing.minDistSq) {
                existing.route = route
                existing.minDistSq = distSq
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
