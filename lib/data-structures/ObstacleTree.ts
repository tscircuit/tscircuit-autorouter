import { Obstacle } from "lib/types"
import { ISpatialIndex } from "./SpatialIndex"
import { RbushIndex } from "./RbushIndex"
import { FlatbushIndex } from "./FlatbushIndex"

export type BucketCoordinate = `${number}x${number}`

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
    this.idx.insert(
      o,
      o.center.x - o.width / 2,
      o.center.y - o.height / 2,
      o.center.x + o.width / 2,
      o.center.y + o.height / 2,
    )
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
      const nodeMinX = obstacle.center.x - obstacle.width / 2
      const nodeMinY = obstacle.center.y - obstacle.height / 2
      const nodeMaxX = obstacle.center.x + obstacle.width / 2
      const nodeMaxY = obstacle.center.y + obstacle.height / 2
      for (let x = nodeMinX; x <= nodeMaxX; x += this.CELL_SIZE) {
        for (let y = nodeMinY; y <= nodeMaxY; y += this.CELL_SIZE) {
          const bucketKey = this.getBucketKey(x, y)
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
    for (let x = minX; x <= maxX; x += this.CELL_SIZE) {
      for (let y = minY; y <= maxY; y += this.CELL_SIZE) {
        const bucketKey = this.getBucketKey(x, y)
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
