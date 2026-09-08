import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

class FilteredPlanarQuerySolver extends SingleHighDensityRouteSolver {
  queriedNodes: Array<{ x: number; y: number; z: number }> = []

  override getPlanarObstacleQuery(
    node: Node,
  ): ReturnType<SingleHighDensityRouteSolver["getPlanarObstacleQuery"]> {
    this.queriedNodes.push({ x: node.x, y: node.y, z: node.z })
    const query = super.getPlanarObstacleQuery(node)
    if (!query) return undefined
    return {
      ...query,
      segmentIds: [],
    }
  }
}

test("planar neighbor queries respect an overridden candidate obstacle filter", () => {
  const options = {
    connectionName: "route",
    minDistBetweenEnteringPoints: 0.15,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -2, y: 0, z: 0 },
    B: { x: 2, y: 0, z: 0 },
    availableZ: [0],
    obstacleRoutes: [
      {
        connectionName: "obstacle",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: -1, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        vias: [],
      },
    ],
  }
  const node: Node = {
    x: 0,
    y: 0,
    z: 0,
    g: 0,
    h: 0,
    f: 0,
    parent: null,
  }
  const filtered = new FilteredPlanarQuerySolver(options)
  const unfiltered = new SingleHighDensityRouteSolver(options)
  expect(unfiltered.getNeighbors(node)).toHaveLength(0)
  const neighbors = filtered.getNeighbors(node)
  expect(neighbors).toHaveLength(8)
  expect(filtered.queriedNodes).toEqual(
    neighbors.map(({ x, y, z }) => ({ x, y, z })),
  )
  expect(filtered.debug_nodesTooCloseToObstacle.size).toBe(0)
  expect(filtered.debug_nodePathToParentIntersectsObstacle.size).toBe(0)
})
