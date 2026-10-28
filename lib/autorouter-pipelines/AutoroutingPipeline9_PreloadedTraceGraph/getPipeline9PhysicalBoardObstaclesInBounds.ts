import Flatbush from "flatbush"
import type { Obstacle } from "lib/types/srj-types"

export type Pipeline9PhysicalObstacleQueryBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const originalBoardIndexes = new WeakMap<readonly Obstacle[], Flatbush | null>()

/** Broad phase for immutable original board geometry; ownership and layers remain exact-check inputs. */
export const getPipeline9PhysicalBoardObstaclesInBounds = (
  boardObstacles: readonly Obstacle[],
  bounds: Readonly<Pipeline9PhysicalObstacleQueryBounds>,
): Obstacle[] => {
  let index = originalBoardIndexes.get(boardObstacles)
  if (index === undefined) {
    index = boardObstacles.length === 0 ? null : new Flatbush(boardObstacles.length)
    if (index) {
      for (const obstacle of boardObstacles) {
        const angle = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
        const halfWidth = obstacle.width / 2
        const halfHeight = obstacle.height / 2
        const extentX = obstacle.shape === "circle" ? halfWidth
          : Math.abs(Math.cos(angle)) * halfWidth + Math.abs(Math.sin(angle)) * halfHeight
        const extentY = obstacle.shape === "circle" ? halfWidth
          : Math.abs(Math.sin(angle)) * halfWidth + Math.abs(Math.cos(angle)) * halfHeight
        index.add(
          obstacle.center.x - extentX,
          obstacle.center.y - extentY,
          obstacle.center.x + extentX,
          obstacle.center.y + extentY,
        )
      }
      index.finish()
    }
    originalBoardIndexes.set(boardObstacles, index)
  }
  if (!index) return []
  return index.search(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY)
    .sort((left, right) => left - right)
    .map((obstacleIndex) => boardObstacles[obstacleIndex]!)
}
