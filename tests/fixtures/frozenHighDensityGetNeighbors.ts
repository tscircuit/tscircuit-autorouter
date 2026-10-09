import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import type { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

type PlanarObstacleQuery = ReturnType<
  SingleHighDensityRouteSolver["getPlanarObstacleQuery"]
>

export function frozenHighDensityGetNeighbors(
  this: SingleHighDensityRouteSolver,
  node: Node,
): Node[] {
  const neighbors: Node[] = []
  let sharedPlanarObstacleQuery: PlanarObstacleQuery | undefined
  let queriedPlanarNeighbors = false

  const { maxX, minX, maxY, minY } = this.bounds

  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      if (x === 0 && y === 0) continue

      const neighbor: Node = {
        x: clamp(node.x + x * this.cellStep, minX, maxX),
        y: clamp(node.y + y * this.cellStep, minY, maxY),
        z: node.z,
        g: node.g,
        h: node.h,
        f: node.f,
        parent: node,
      }

      const neighborKey = this.getNodeKey(neighbor)

      if (this.exploredNodes.has(neighborKey)) {
        continue
      }

      if (!queriedPlanarNeighbors) {
        sharedPlanarObstacleQuery = this.getPlanarNeighborObstacleQuery(node)
        queriedPlanarNeighbors = true
      }
      const planarObstacleQuery = this.getPlanarObstacleQuery(
        neighbor,
        sharedPlanarObstacleQuery,
        neighborKey,
      )
      if (
        this.isNodeTooCloseToObstacle(
          neighbor,
          undefined,
          false,
          planarObstacleQuery,
        )
      ) {
        if (this.debugEnabled) {
          this.debug_nodesTooCloseToObstacle.add(neighborKey)
        }
        this.exploredNodes.add(neighborKey)
        continue
      }

      if (this.isNodeTooCloseToEdge(neighbor, false)) {
        this.exploredNodes.add(neighborKey)
        continue
      }

      if (
        this.doesPathToParentIntersectObstacle(neighbor, planarObstacleQuery)
      ) {
        if (this.debugEnabled) {
          this.debug_nodePathToParentIntersectsObstacle.add(neighborKey)
        }
        this.exploredNodes.add(neighborKey)
        continue
      }

      this.setNodeCosts(neighbor)

      neighbors.push(neighbor)
    }
  }

  // Add via neighbors for all other layers (a via can connect any layer to any other layer)
  for (const newZ of this.availableZ) {
    if (newZ === node.z) continue

    const viaNeighbor: Node = {
      x: node.x,
      y: node.y,
      z: newZ,
      g: node.g,
      h: node.h,
      f: node.f,
      parent: node,
    }

    if (
      !this.exploredNodes.has(this.getNodeKey(viaNeighbor)) &&
      !this.isNodeTooCloseToObstacle(
        viaNeighbor,
        this.viaDiameter / 2 + this.obstacleMargin / 2,
        true,
      ) &&
      !this.isNodeTooCloseToEdge(viaNeighbor, true)
    ) {
      this.setNodeCosts(viaNeighbor)

      neighbors.push(viaNeighbor)
    }
  }

  return neighbors
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}
