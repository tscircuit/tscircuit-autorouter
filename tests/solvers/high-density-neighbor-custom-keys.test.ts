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

test("custom node keys receive the actual neighbor objects before visited checks", () => {
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
  const parent: Node = { x: 0, y: 0, z: 0, g: 2, h: 3, f: 4, parent: null }
  const neighbors = custom.getNeighbors(parent)
  expect(neighbors.length).toBeGreaterThan(0)
  expect(neighbors.every((node) => custom.keyedNodes.has(node))).toBe(true)
  const visitedKey = custom.getNodeKey(neighbors[0]!)
  custom.exploredNodes.add(visitedKey)
  const remaining = custom.getNeighbors(parent)
  expect(remaining.every((node) => custom.getNodeKey(node) !== visitedKey)).toBe(
    true,
  )
})
