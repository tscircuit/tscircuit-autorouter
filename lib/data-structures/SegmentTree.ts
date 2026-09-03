interface Point {
  x: number
  y: number
  z: number
}

type Segment = [Point, Point]

type SegmentWithId = [Point, Point, string]

const getSegmentBounds = (segment: Segment) => {
  return {
    minX: Math.min(segment[0].x, segment[1].x),
    maxX: Math.max(segment[0].x, segment[1].x),
    minY: Math.min(segment[0].y, segment[1].y),
    maxY: Math.max(segment[0].y, segment[1].y),
  }
}
export type BucketCoordinate = `${number}x${number}`

export class SegmentTree {
  buckets: Map<BucketCoordinate, SegmentWithId[]>
  CELL_SIZE = 0.4
  SEGMENT_MARGIN: number

  constructor(
    public segments: Segment[],
    segmentMargin = 0.4,
  ) {
    this.buckets = new Map()
    this.SEGMENT_MARGIN = segmentMargin
    const segmentsById = new Map<string, Segment>() // Avoid adding duplicates if input has them

    for (const segment of segments) {
      const segmentKey = this.getSegmentKey(segment)
      if (segmentsById.has(segmentKey)) continue // Skip duplicates in input
      segmentsById.set(segmentKey, segment)

      const bounds = getSegmentBounds(segment)

      // Calculate min/max integer indices covered by the segment's bounds
      const minIndexX = Math.floor(bounds.minX / this.CELL_SIZE)
      const maxIndexX = Math.floor(bounds.maxX / this.CELL_SIZE)
      const minIndexY = Math.floor(bounds.minY / this.CELL_SIZE)
      const maxIndexY = Math.floor(bounds.maxY / this.CELL_SIZE)

      // Iterate through the integer indices
      for (let ix = minIndexX; ix <= maxIndexX; ix++) {
        for (let iy = minIndexY; iy <= maxIndexY; iy++) {
          const bucketKey = `${ix}x${iy}` as BucketCoordinate // Construct key from indices
          const bucket = this.buckets.get(bucketKey)
          const segmentWithId: SegmentWithId = [
            segment[0],
            segment[1],
            segmentKey,
          ]

          if (!bucket) {
            this.buckets.set(bucketKey, [segmentWithId])
          } else {
            // Optional: Check if segment already in this specific bucket if constructor might be called multiple times
            // or if input segments could be complex overlaps. Usually not needed if input is processed once.
            bucket.push(segmentWithId)
          }
        }
      }
    }
  }

  getBucketKey(x: number, y: number): BucketCoordinate {
    return `${Math.floor(x / this.CELL_SIZE)}x${Math.floor(y / this.CELL_SIZE)}`
  }

  getSegmentKey(segment: Segment): string {
    return `${segment[0].x}-${segment[0].y}-${segment[0].z}-${segment[1].x}-${segment[1].y}-${segment[1].z}`
  }

  getSegmentsThatCouldIntersect(A: Point, B: Point): SegmentWithId[] {
    const segments: SegmentWithId[] = []
    const alreadyAddedSegments = new Set<string>()

    // Calculate the margined bounding box of the query segment
    const minX = Math.min(A.x, B.x) - this.SEGMENT_MARGIN
    const minY = Math.min(A.y, B.y) - this.SEGMENT_MARGIN
    const maxX = Math.max(A.x, B.x) + this.SEGMENT_MARGIN
    const maxY = Math.max(A.y, B.y) + this.SEGMENT_MARGIN

    // Calculate min/max integer indices covered by the margined query bounds
    const minIndexX = Math.floor(minX / this.CELL_SIZE)
    const maxIndexX = Math.floor(maxX / this.CELL_SIZE)
    const minIndexY = Math.floor(minY / this.CELL_SIZE)
    const maxIndexY = Math.floor(maxY / this.CELL_SIZE)

    // Iterate through the integer indices
    for (let ix = minIndexX; ix <= maxIndexX; ix++) {
      for (let iy = minIndexY; iy <= maxIndexY; iy++) {
        const bucketKey = `${ix}x${iy}` as BucketCoordinate // Construct key from indices
        const bucket = this.buckets.get(bucketKey)

        if (bucket) {
          // Check if bucket exists
          for (const segment of bucket) {
            const key = segment[2] // The segment key is stored at index 2
            if (!alreadyAddedSegments.has(key)) {
              alreadyAddedSegments.add(key)
              segments.push(segment)
            }
          }
        }
      }
    }
    return segments
  }
}
