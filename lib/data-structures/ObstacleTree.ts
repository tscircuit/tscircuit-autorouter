import { Obstacle } from "lib/types"
import { ISpatialIndex } from "./SpatialIndex"
import { RbushIndex } from "./RbushIndex"
import { FlatbushIndex } from "./FlatbushIndex"

export type BucketCoordinate = `${number}x${number}`

const getObstacleBounds = (obstacle: Obstacle) => {
  const rotationRadians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const cos = Math.abs(Math.cos(rotationRadians))
  const sin = Math.abs(Math.sin(rotationRadians))
  const halfWidth = (obstacle.width * cos + obstacle.height * sin) / 2
  const halfHeight = (obstacle.width * sin + obstacle.height * cos) / 2

  return {
    minX: obstacle.center.x - halfWidth,
    minY: obstacle.center.y - halfHeight,
    maxX: obstacle.center.x + halfWidth,
    maxY: obstacle.center.y + halfHeight,
  }
}

/**
 * ObstacleTree wraps different spatial index implementations:
 * - 'native': original spatial-hash grid
 * - 'rbush': dynamic R-tree via rbush
 * - 'flatbush': static index via flatbush
 */
export class ObstacleSpatialHashIndex {
  private idx: ISpatialIndex<Obstacle>
  private storage: Obstacle[] = []

  constructor(
    implementation: "native" | "rbush" | "flatbush" = "native",
    obstacles: Obstacle[] = [],
  ) {
    if (implementation === "flatbush") {
      if (obstacles.length === 0) {
        // use rbush for empty data to avoid Flatbush limitations
        this.idx = new RbushIndex<Obstacle>()
        implementation = "rbush"
      } else {
        this.idx = new FlatbushIndex<Obstacle>(obstacles.length)
      }
    } else if (implementation === "rbush") {
      this.idx = new RbushIndex<Obstacle>()
    } else {
      // fallback to native spatial-hash
      this.idx = new (class implements ISpatialIndex<Obstacle> {
        private shi = new NativeObstacleTree(obstacles)
        insert(item: Obstacle): void {
          /* no-op */
        }
        search(
          minX: number,
          minY: number,
          maxX: number,
          maxY: number,
        ): Obstacle[] {
          const centerX = (minX + maxX) / 2
          const centerY = (minY + maxY) / 2
          const width = maxX - minX
          const height = maxY - minY
          return this.shi.getNodesInArea(centerX, centerY, width, height)
        }
        clear(): void {
          /* no-op */
        }
      })()
    }

    // bulk-load initial obstacles
    obstacles.forEach((o) => this.insert(o))
    if (implementation === "flatbush" && obstacles.length > 0)
      this.idx.finish?.()
  }

  insert(o: Obstacle) {
    this.storage.push(o)
    const { minX, minY, maxX, maxY } = getObstacleBounds(o)
    this.idx.insert(o, minX, minY, maxX, maxY)
  }

  search(bbox: {
    minX: number
    minY: number
    maxX: number
    maxY: number
  }): Obstacle[] {
    return this.idx.search(bbox.minX, bbox.minY, bbox.maxX, bbox.maxY)
  }

  searchArea(
    centerX: number,
    centerY: number,
    width: number,
    height: number,
  ): Obstacle[] {
    return this.search({
      minX: centerX - width / 2,
      minY: centerY - height / 2,
      maxX: centerX + width / 2,
      maxY: centerY + height / 2,
    })
  }
}

export class NativeObstacleTree {
  buckets: Map<BucketCoordinate, [Obstacle, number][]>
  CELL_SIZE = 0.4

  constructor(public obstacles: Obstacle[]) {
    // console.log(
    //   `[ObstacleSHI] Initializing with ${obstacles.length} obstacles. CELL_SIZE: ${this.CELL_SIZE}`,
    // )
    this.buckets = new Map()
    let bucketEntriesCount = 0
    // for (const obstacle of obstacles) {
    for (let i = 0; i < obstacles.length; i++) {
      const obstacle = obstacles[i]
      const {
        minX: nodeMinX,
        minY: nodeMinY,
        maxX: nodeMaxX,
        maxY: nodeMaxY,
      } = getObstacleBounds(obstacle)
      const minBucketX = Math.floor(nodeMinX / this.CELL_SIZE)
      const minBucketY = Math.floor(nodeMinY / this.CELL_SIZE)
      const maxBucketX = Math.floor(nodeMaxX / this.CELL_SIZE)
      const maxBucketY = Math.floor(nodeMaxY / this.CELL_SIZE)
      for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX++) {
        for (let bucketY = minBucketY; bucketY <= maxBucketY; bucketY++) {
          const bucketKey = `${bucketX}x${bucketY}` as BucketCoordinate
          const bucket = this.buckets.get(bucketKey)
          if (!bucket) {
            this.buckets.set(bucketKey, [[obstacle, i]])
          } else {
            bucket.push([obstacle, i])
            bucketEntriesCount++
          }
        }
      }
    }
    // console.log(
    //   `[ObstacleSHI] Initialization complete. Populated ${this.buckets.size} buckets with ${bucketEntriesCount} total entries.`,
    // )
  }

  getBucketKey(x: number, y: number): BucketCoordinate {
    return `${Math.floor(x / this.CELL_SIZE)}x${Math.floor(y / this.CELL_SIZE)}`
  }

  getNodesInArea(
    centerX: number,
    centerY: number,
    width: number,
    height: number,
  ): Obstacle[] {
    const obstacles: Obstacle[] = []
    const alreadyAddedObstacles = new Set<number>()
    const minX = centerX - width / 2
    const minY = centerY - height / 2
    const maxX = centerX + width / 2
    const maxY = centerY + height / 2
    const minBucketX = Math.floor(minX / this.CELL_SIZE)
    const minBucketY = Math.floor(minY / this.CELL_SIZE)
    const maxBucketX = Math.floor(maxX / this.CELL_SIZE)
    const maxBucketY = Math.floor(maxY / this.CELL_SIZE)
    for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX++) {
      for (let bucketY = minBucketY; bucketY <= maxBucketY; bucketY++) {
        const bucketKey = `${bucketX}x${bucketY}` as BucketCoordinate
        const bucket = this.buckets.get(bucketKey) || []
        for (const obstacleWithIndex of bucket) {
          if (alreadyAddedObstacles.has(obstacleWithIndex[1])) continue
          alreadyAddedObstacles.add(obstacleWithIndex[1])
          obstacles.push(obstacleWithIndex[0])
        }
      }
    }
    return obstacles
  }
}
