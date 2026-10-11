// Pinned from @tscircuit/checks 0.0.233 bundled source; see the authoritative-drc-fork LICENSE and PROVENANCE.md.
export type BucketCoordinate = `${number}x${number}`

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type GetBoundsFn<T> = (obj: T) => Bounds
export type GetIdFn<T> = (obj: T) => string

export class SpatialObjectIndex<T> {
  buckets: Map<BucketCoordinate, Array<T & { spatialIndexId: string }>>
  objectsById: Map<string, T & { spatialIndexId: string }>
  getBounds: GetBoundsFn<T>
  getId: GetIdFn<T>
  CELL_SIZE = 0.4

  constructor({
    objects,
    getBounds,
    getId,
    CELL_SIZE,
  }: {
    objects: T[]
    getBounds: GetBoundsFn<T>
    getId?: GetIdFn<T>
    CELL_SIZE?: number
  }) {
    this.buckets = new Map()
    this.objectsById = new Map()
    this.getBounds = getBounds
    this.getId = getId ?? (() => this._getNextId())
    this.CELL_SIZE = CELL_SIZE ?? this.CELL_SIZE

    for (const obj of objects) {
      this.addObject(obj)
    }
  }

  _idCounter = 0
  _getNextId(): string {
    return `${this._idCounter++}`
  }

  addObject(obj: T): void {
    const bounds = this.getBounds(obj)
    const spatialIndexId = this.getId(obj)
    const objWithId = { ...obj, spatialIndexId } as T & {
      spatialIndexId: string
    }

    // Store in objectsById for quick lookup
    this.objectsById.set(spatialIndexId, objWithId)

    // Calculate the bucket coordinates that cover the object's bounds
    const minBucketX = Math.floor(bounds.minX / this.CELL_SIZE)
    const minBucketY = Math.floor(bounds.minY / this.CELL_SIZE)
    const maxBucketX = Math.floor(bounds.maxX / this.CELL_SIZE)
    const maxBucketY = Math.floor(bounds.maxY / this.CELL_SIZE)

    // Add the object to all buckets it intersects with
    for (let bx = minBucketX; bx <= maxBucketX; bx++) {
      for (let by = minBucketY; by <= maxBucketY; by++) {
        const bucketKey = `${bx}x${by}` as BucketCoordinate
        const bucket = this.buckets.get(bucketKey)
        if (!bucket) {
          this.buckets.set(bucketKey, [objWithId])
        } else {
          bucket.push(objWithId)
        }
      }
    }
  }

  removeObject(id: string): boolean {
    const obj = this.objectsById.get(id)
    if (!obj) return false

    // Remove from objectsById
    this.objectsById.delete(id)

    // Calculate the bucket coordinates that cover the object's bounds
    const bounds = this.getBounds(obj)
    const minBucketX = Math.floor(bounds.minX / this.CELL_SIZE)
    const minBucketY = Math.floor(bounds.minY / this.CELL_SIZE)
    const maxBucketX = Math.floor(bounds.maxX / this.CELL_SIZE)
    const maxBucketY = Math.floor(bounds.maxY / this.CELL_SIZE)

    // Remove the object from all buckets it might be in
    for (let bx = minBucketX; bx <= maxBucketX; bx++) {
      for (let by = minBucketY; by <= maxBucketY; by++) {
        const bucketKey = `${bx}x${by}` as BucketCoordinate
        const bucket = this.buckets.get(bucketKey)
        if (bucket) {
          const index = bucket.findIndex((item) => item.spatialIndexId === id)
          if (index !== -1) {
            bucket.splice(index, 1)
            if (bucket.length === 0) {
              this.buckets.delete(bucketKey)
            }
          }
        }
      }
    }

    return true
  }

  getBucketKey(x: number, y: number): BucketCoordinate {
    return `${Math.floor(x / this.CELL_SIZE)}x${Math.floor(y / this.CELL_SIZE)}`
  }

  getObjectsInBounds(bounds: Bounds, margin = 0): T[] {
    const objects: T[] = []
    const addedIds = new Set<string>()

    // Calculate the bucket coordinates that cover the requested bounds with margin
    const minBucketX = Math.floor((bounds.minX - margin) / this.CELL_SIZE)
    const minBucketY = Math.floor((bounds.minY - margin) / this.CELL_SIZE)
    const maxBucketX = Math.floor((bounds.maxX + margin) / this.CELL_SIZE)
    const maxBucketY = Math.floor((bounds.maxY + margin) / this.CELL_SIZE)

    // Collect objects from all buckets that intersect the bounds
    for (let bx = minBucketX; bx <= maxBucketX; bx++) {
      for (let by = minBucketY; by <= maxBucketY; by++) {
        const bucketKey = `${bx}x${by}` as BucketCoordinate
        const bucket = this.buckets.get(bucketKey) || []

        for (const obj of bucket) {
          const id = obj.spatialIndexId
          if (addedIds.has(id)) continue

          addedIds.add(id)
          objects.push(obj)
        }
      }
    }

    return objects
  }
}
