import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

test("unexplored neighbors preserve custom key calls and source reads", (): void => {
  for (const customKey of [false, true]) {
    const solver = new SingleHighDensityRouteSolver({
      connectionName: "neighbor-allocation",
      bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
      A: { x: -1, y: -1, z: 0 },
      B: { x: 1, y: 1, z: 0 },
      obstacleRoutes: [],
      minDistBetweenEnteringPoints: 1,
      availableZ: [0],
    })
    solver.cellStep = 1
    solver.gridMinXIndex = solver.gridMinYIndex = -2
    solver.gridWidth = solver.gridHeight = 5
    const reads: string[] = []
    const node: Node = {
      get x(): number {
        reads.push("x")
        return 0
      },
      get y(): number {
        reads.push("y")
        return 0
      },
      get z(): number {
        reads.push("z")
        return 0
      },
      get g(): number {
        reads.push("g")
        return 2
      },
      get h(): number {
        reads.push("h")
        return 3
      },
      get f(): number {
        reads.push("f")
        return 5
      },
      parent: null,
    }
    const nativeKey = solver.getNodeKey
    const keyedNeighbors: Node[] = []
    const key = customKey
      ? function (this: SingleHighDensityRouteSolver, neighbor: Node): number {
          expect(this).toBe(solver)
          keyedNeighbors.push(neighbor)
          return nativeKey.call(this, neighbor)
        }
      : nativeKey
    Object.defineProperty(solver, "getNodeKey", {
      get: (): typeof nativeKey => {
        reads.push("key")
        return key
      },
    })
    solver.exploredNodes.add(6)
    solver.exploredNodes.add(12)
    solver.exploredNodes.add(18)
    solver.getPlanarNeighborObstacleQuery = (): undefined => undefined
    solver.getPlanarObstacleQuery = (): undefined => undefined
    solver.isNodeTooCloseToObstacle = (): boolean => false
    solver.isNodeTooCloseToEdge = (): boolean => false
    solver.doesPathToParentIntersectObstacle = (): boolean => false
    solver.setNodeCosts = (neighbor: Node): void => {
      neighbor.g = 7
      neighbor.h = 11
      neighbor.f = 18
    }
    const neighbors = solver.getNeighbors(node)
    expect(neighbors.map(({ x, y }) => [x, y])).toEqual([
      [-1, 0],
      [-1, 1],
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 0],
    ])
    expect(reads).toEqual([
      ...Array.from({ length: 8 }, () => [
        "x",
        "y",
        "z",
        "g",
        "h",
        "f",
        "key",
      ]).flat(),
      "z",
    ])
    expect(new Set(neighbors).size).toBe(6)
    for (const neighbor of neighbors) {
      expect(neighbor.parent).toBe(node)
      expect([neighbor.g, neighbor.h, neighbor.f]).toEqual([7, 11, 18])
    }
    if (customKey) {
      expect(keyedNeighbors.length).toBe(8)
      expect(new Set(keyedNeighbors).size).toBe(8)
      expect(keyedNeighbors[0]).toEqual({
        x: -1,
        y: -1,
        z: 0,
        g: 2,
        h: 3,
        f: 5,
        parent: node,
      })
      expect(neighbors[0]).toBe(keyedNeighbors[1])
    }
  }
})
