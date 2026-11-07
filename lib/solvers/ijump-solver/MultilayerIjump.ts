export interface Point2D {
  x: number
  y: number
}

export interface ObstacleHit {
  normal: Point2D
}

export interface IjumpNode {
  x: number
  y: number
  z: number
  parent: IjumpNode | null
  obstacleHit: ObstacleHit | null
}

const ORTHOGONAL_DIRS: Point2D[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

export class MultilayerIjump {
  goal: Point2D

  constructor(goal: Point2D) {
    this.goal = goal
  }

  getWallDistance(_node: IjumpNode, _travelDir: Point2D): { wallDistance: number; obstacleHit: ObstacleHit | null } {
    return { wallDistance: Infinity, obstacleHit: null }
  }

  createNeighbor(node: IjumpNode, travelDir: Point2D, travelDistance: number, obstacleHit: ObstacleHit | null): IjumpNode {
    return {
      x: node.x + travelDir.x * travelDistance,
      y: node.y + travelDir.y * travelDistance,
      z: node.z,
      parent: node,
      obstacleHit,
    }
  }

  getNeighbors(node: IjumpNode): IjumpNode[] {
    const neighbors: IjumpNode[] = []
    for (const travelDir of ORTHOGONAL_DIRS) {
      if (
        node.parent &&
        node.obstacleHit &&
        (travelDir.x !== 0
          ? Math.sign(travelDir.x) === -Math.sign(node.obstacleHit.normal.x)
          : Math.sign(travelDir.y) === -Math.sign(node.obstacleHit.normal.y))
      ) {
        continue
      }

      const { wallDistance, obstacleHit } = this.getWallDistance(node, travelDir)
      const goalDistAlongTravelDir =
        (this.goal.x - node.x) * travelDir.x +
        (this.goal.y - node.y) * travelDir.y

      if (wallDistance === Infinity) {
        if (goalDistAlongTravelDir <= 0) continue

        neighbors.push(
          this.createNeighbor(node, travelDir, goalDistAlongTravelDir, null)
        )
        continue
      }

      if (goalDistAlongTravelDir > 0 && goalDistAlongTravelDir < wallDistance) {
        neighbors.push(
          this.createNeighbor(node, travelDir, goalDistAlongTravelDir, null)
        )
      } else if (wallDistance > 0) {
        neighbors.push(
          this.createNeighbor(node, travelDir, wallDistance, obstacleHit)
        )
      }
    }
    return neighbors
  }
}
