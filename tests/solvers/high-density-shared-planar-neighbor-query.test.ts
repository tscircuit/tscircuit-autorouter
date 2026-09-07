import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

class IndividualQuerySolver extends SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost {
  override isNodeTooCloseToObstacle(
    node: Node,
    margin?: number,
    isVia?: boolean,
    query?: Parameters<SingleHighDensityRouteSolver["isNodeTooCloseToObstacle"]>[3],
  ): boolean {
    return super.isNodeTooCloseToObstacle(
      node,
      margin,
      isVia,
      query ? this.getPlanarObstacleQuery(node) : undefined,
    )
  }

  override doesPathToParentIntersectObstacle(
    node: Node,
    query?: Parameters<SingleHighDensityRouteSolver["doesPathToParentIntersectObstacle"]>[1],
  ): boolean {
    return super.doesPathToParentIntersectObstacle(
      node,
      query ? this.getPlanarObstacleQuery(node) : undefined,
    )
  }
}

test("sharing planar neighbor queries preserves the complete search and queries the layer once", () => {
  let seed = 12345
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }

  for (let sample = 0; sample < 24; sample++) {
    const obstacleRoutes: HighDensityIntraNodeRoute[] = Array.from(
      { length: 5 },
      (_, index) => {
        const x = -1.5 + random() * 3
        const y = -1.5 + random() * 3
        const z = index % 2
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
      minDistBetweenEnteringPoints: 0.2,
      bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
      A: { x: -2, y: -1 + random() * 2, z: 0 },
      B: { x: 2, y: -1 + random() * 2, z: sample % 2 },
      availableZ: sample % 3 === 0 ? [0] : [0, 1],
      nearbySegmentClearance: sample % 4 === 0 ? 0.4 : 0.15,
      futureConnections: [
        {
          connectionName: "future",
          points: [
            { x: 0, y: -2, z: 0 },
            { x: 0, y: 2, z: 1 },
          ],
        },
      ],
    }
    const shared = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(opts)
    const individual = new IndividualQuerySolver(opts)
    shared.solve()
    individual.solve()

    expect({
      solved: shared.solved,
      failed: shared.failed,
      iterations: shared.iterations,
      route: shared.solvedPath,
      explored: shared.debug_exploredNodesOrdered,
      blocked: [...shared.debug_nodesTooCloseToObstacle],
      intersected: [...shared.debug_nodePathToParentIntersectsObstacle],
    }).toEqual({
      solved: individual.solved,
      failed: individual.failed,
      iterations: individual.iterations,
      route: individual.solvedPath,
      explored: individual.debug_exploredNodesOrdered,
      blocked: [...individual.debug_nodesTooCloseToObstacle],
      intersected: [...individual.debug_nodePathToParentIntersectsObstacle],
    })
  }

  const solver = new SingleHighDensityRouteSolver({
    connectionName: "route",
    minDistBetweenEnteringPoints: 0.2,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -2, y: 0, z: 0 },
    B: { x: 2, y: 0, z: 0 },
    availableZ: [0],
    obstacleRoutes: [{
      connectionName: "obstacle",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [{ x: -1, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }],
      vias: [],
    }],
  })
  const index = solver.obstacleSegmentIndexByLayer.get(0)!
  const originalSearch = index.search.bind(index)
  let searches = 0
  index.search = (...args: Parameters<typeof originalSearch>): number[] => {
    searches++
    return originalSearch(...args)
  }
  const neighbors = solver.getNeighbors({
    x: 0, y: 0, z: 0, g: 0, h: 0, f: 0, parent: null,
  })
  expect(neighbors).toHaveLength(8)
  expect(searches).toBe(1)
})
