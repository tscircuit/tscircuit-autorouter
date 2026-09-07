import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

class CustomKeySolver extends SingleHighDensityRouteSolver {
  keyedNodes = new Set<Node>()

  override getNodeKey(node: Node): number {
    this.keyedNodes.add(node)
    const originalKey = super.getNodeKey(node)
    const customKey = originalKey % 2 === 0 ? originalKey + 0.25 : -originalKey
    return customKey
  }
}

test("bounded explored storage handles custom key functions and very large grids", () => {
  const opts = {
    connectionName: "custom-keys",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.15,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -2, y: 0, z: 0 },
    B: { x: 2, y: 0, z: 1 },
    availableZ: [0, 1],
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
  const custom = new CustomKeySolver(opts)
  const nativeSet = new CustomKeySolver(opts)
  nativeSet.exploredNodes = new Set()
  const parent: Node = { x: 0, y: 0, z: 0, g: 2, h: 3, f: 4, parent: null }
  const neighbors = custom.getNeighbors(parent)
  expect(neighbors.length).toBeGreaterThan(0)
  expect(neighbors.every((node) => custom.keyedNodes.has(node))).toBe(true)
  custom.exploredNodes.clear()
  custom.solve()
  nativeSet.solve()
  expect({
    solved: custom.solved,
    failed: custom.failed,
    iterations: custom.iterations,
    route: custom.solvedPath,
    explored: [...custom.exploredNodes],
  }).toEqual({
    solved: nativeSet.solved,
    failed: nativeSet.failed,
    iterations: nativeSet.iterations,
    route: nativeSet.solvedPath,
    explored: [...nativeSet.exploredNodes],
  })

  const large = new SingleHighDensityRouteSolver({
    ...opts,
    minDistBetweenEnteringPoints: 0,
    bounds: { minX: -500, maxX: 500, minY: -500, maxY: 500 },
  })
  const storage = large.exploredNodes as Set<number> & {
    bitmap: Uint8Array | null
  }
  expect(storage.bitmap).toBeNull()
  const key = large.getNodeKey(parent)
  storage.add(key)
  expect(storage.has(key)).toBe(true)
  expect([...storage]).toEqual([key])
})
