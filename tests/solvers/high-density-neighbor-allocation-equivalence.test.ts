import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

class OriginalAllocationReferenceSolver extends SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost {
  override getNodeKey(node: Node): number {
    const xIndex = Math.round(node.x / this.cellStep) - this.gridMinXIndex
    const yIndex = Math.round(node.y / this.cellStep) - this.gridMinYIndex
    const key = (node.z * this.gridHeight + yIndex) * this.gridWidth + xIndex
    return key
  }
}

test("delayed neighbor allocation preserves object-first searches", () => {
  let randomSeed = 84137
  const random = (): number => {
    randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0
    return randomSeed / 0x100000000
  }
  for (let sample = 0; sample < 24; sample++) {
    const layerCount = sample % 3 === 0 ? 4 : 2
    const jitter = sample % 2 === 0 ? 1e-12 : 0
    const obstacleRoutes: HighDensityIntraNodeRoute[] = Array.from(
      { length: 5 },
      (_, index) => {
        const x = -1.4 + random() * 2.8
        const y = -1.4 + random() * 2.8
        const z = index % layerCount
        return {
          connectionName: `obstacle-${index}`,
          traceThickness: 0.15,
          viaDiameter: 0.3,
          route: [
            { x, y, z },
            { x: x + random() - 0.5, y: y + random() - 0.5, z },
          ],
          vias: index === 0 ? [{ x, y }] : [],
        }
      },
    )
    const opts = {
      connectionName: "route",
      obstacleRoutes,
      minDistBetweenEnteringPoints: 0.15,
      bounds: {
        minX: -2 + jitter,
        maxX: 2.013,
        minY: -2.017,
        maxY: 2.007 - jitter,
      },
      A: { x: -2 + jitter, y: -0.751 + random() * 1.5, z: 0 },
      B: { x: 2.013, y: -0.747 + random() * 1.5, z: sample % layerCount },
      availableZ: Array.from({ length: layerCount }, (_, z) => z),
      layerCount,
      hyperParameters: { CELL_SIZE_FACTOR: sample % 2 === 0 ? 0.5 : 1 },
      futureConnections: [
        {
          connectionName: "future",
          points: [
            { x: -0.3, y: -2.017, z: 0 },
            { x: 0.7, y: 2.007 - jitter, z: layerCount - 1 },
          ],
        },
      ],
    }
    const optimized = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(
      opts,
    )
    const reference = new OriginalAllocationReferenceSolver(opts)
    optimized.solve()
    reference.solve()
    expect({
      solved: optimized.solved,
      failed: optimized.failed,
      error: optimized.error,
      iterations: optimized.iterations,
      route: optimized.solvedPath,
      explored: [...optimized.exploredNodes],
      explorationOrder: optimized.debug_exploredNodesOrdered,
      blocked: [...optimized.debug_nodesTooCloseToObstacle],
      intersected: [...optimized.debug_nodePathToParentIntersectsObstacle],
    }).toEqual({
      solved: reference.solved,
      failed: reference.failed,
      error: reference.error,
      iterations: reference.iterations,
      route: reference.solvedPath,
      explored: [...reference.exploredNodes],
      explorationOrder: reference.debug_exploredNodesOrdered,
      blocked: [...reference.debug_nodesTooCloseToObstacle],
      intersected: [...reference.debug_nodePathToParentIntersectsObstacle],
    })
  }
})
