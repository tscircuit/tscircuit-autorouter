import { RbushIndex } from "./RbushIndex"
import { ISpatialIndex } from "./SpatialIndex"

import { FlatbushIndex } from "./FlatbushIndex"

interface Point {
  x: number
  y: number
  z: number
}

type Segment = [Point, Point]

type SegmentWithId = [Point, Point, string]

type SegmentTreeOptions = {
  implementation?: "native" | "rbush" | "flatbush"
  cellSize?: number
  segmentMargin?: number
}

const getSegmentBounds = (segment: Segment) => ({
  minX: Math.min(segment[0].x, segment[1].x),
  maxX: Math.max(segment[0].x, segment[1].x),
  minY: Math.min(segment[0].y, segment[1].y),
  maxY: Math.max(segment[0].y, segment[1].y),
})

export class SegmentTree {
  private index: ISpatialIndex<SegmentWithId>
  private margin: number
  private segmentsMap: Map<string, SegmentWithId>
  private cellSize: number

  constructor(segments: Segment[], options: SegmentTreeOptions = {}) {
    const {
      implementation = "native",
      cellSize = 0.4,
      segmentMargin = 0.4,
    } = options

    this.margin = segmentMargin
    this.cellSize = cellSize
    this.segmentsMap = new Map()

    if (implementation === "flatbush" && segments.length === 0) {
      this.index = {
        insert: () => {},
        search: () => [],
        clear: () => {},
      }
      return
    }

    const segmentsWithId = segments.map((s) => {
      const id = this.getSegmentKey(s)
      const sw: SegmentWithId = [s[0], s[1], id]
      this.segmentsMap.set(id, sw)
      return sw
    })

    switch (implementation) {
      case "rbush":
        this.index = this.createRbushIndex(segmentsWithId)
        break
      case "flatbush":
        this.index = this.createFlatbushIndex(segmentsWithId)
        break
      default:
        this.index = this.createNativeIndex(segmentsWithId)
    }
  }

  private createRbushIndex(
    segments: SegmentWithId[],
  ): ISpatialIndex<SegmentWithId> {
    const rbush = new RbushIndex<SegmentWithId>()
    rbush.bulkLoad?.(
      segments.map((sw) => {
        const bounds = getSegmentBounds([sw[0], sw[1]])
        return {
          item: sw,
          minX: bounds.minX,
          minY: bounds.minY,
          maxX: bounds.maxX,
          maxY: bounds.maxY,
        }
      }),
    )
    return rbush
  }

  private createFlatbushIndex(
    segments: SegmentWithId[],
  ): ISpatialIndex<SegmentWithId> {
    const flatbush = new FlatbushIndex<SegmentWithId>(segments.length)
    segments.forEach((sw) => {
      const bounds = getSegmentBounds([sw[0], sw[1]])
      flatbush.insert(sw, bounds.minX, bounds.minY, bounds.maxX, bounds.maxY)
    })
    flatbush.finish()
    return flatbush
  }

  private createNativeIndex(
    segments: SegmentWithId[],
  ): ISpatialIndex<SegmentWithId> {
    const buckets = new Map<string, SegmentWithId[]>()

    segments.forEach((sw) => {
      const bounds = getSegmentBounds([sw[0], sw[1]])
      const minIndexX = Math.floor(bounds.minX / this.cellSize)
      const maxIndexX = Math.floor(bounds.maxX / this.cellSize)
      const minIndexY = Math.floor(bounds.minY / this.cellSize)
      const maxIndexY = Math.floor(bounds.maxY / this.cellSize)

      for (let ix = minIndexX; ix <= maxIndexX; ix++) {
        for (let iy = minIndexY; iy <= maxIndexY; iy++) {
          const key = `${ix}x${iy}`
          const bucket = buckets.get(key) || []
          if (!bucket.find((s) => s[2] === sw[2])) {
            bucket.push(sw)
            buckets.set(key, bucket)
          }
        }
      }
    })

    return {
      insert: () => {
        /* No-op for native */
      },
      search: (minX, minY, maxX, maxY) => {
        const result = new Set<SegmentWithId>()
        const minIndexX = Math.floor(minX / this.cellSize)
        const maxIndexX = Math.floor(maxX / this.cellSize)
        const minIndexY = Math.floor(minY / this.cellSize)
        const maxIndexY = Math.floor(maxY / this.cellSize)

        for (let ix = minIndexX; ix <= maxIndexX; ix++) {
          for (let iy = minIndexY; iy <= maxIndexY; iy++) {
            const key = `${ix}x${iy}`
            buckets.get(key)?.forEach((sw) => result.add(sw))
          }
        }
        return Array.from(result)
      },
      clear: () => buckets.clear(),
    }
  }

  getSegmentKey(segment: Segment): string {
    return `${segment[0].x}-${segment[0].y}-${segment[0].z}-${segment[1].x}-${segment[1].y}-${segment[1].z}`
  }

  getSegmentsThatCouldIntersect(A: Point, B: Point): SegmentWithId[] {
    const minX = Math.min(A.x, B.x) - this.margin
    const minY = Math.min(A.y, B.y) - this.margin
    const maxX = Math.max(A.x, B.x) + this.margin
    const maxY = Math.max(A.y, B.y) + this.margin

    return this.index.search(minX, minY, maxX, maxY)
  }
}
