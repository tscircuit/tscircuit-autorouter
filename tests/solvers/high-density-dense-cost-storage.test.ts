import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

type CostStorage = {
  denseNodeCostTerms: Array<Record<string, unknown> | undefined> | null | undefined
  nodeCostTermsByGridKey: Map<number, unknown>
}

class CustomKeySolver extends SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost {
  override getNodeKey(node: Node): number {
    const xIndex = Math.round(node.x / this.cellStep) - this.gridMinXIndex
    const yIndex = Math.round(node.y / this.cellStep) - this.gridMinYIndex
    const originalKey = (node.z * this.gridHeight + yIndex) * this.gridWidth + xIndex
    const customKey = -originalKey - 0.5
    return customKey
  }
}

test("dense cost slots initialize lazily and retain sparse handling of custom, oversized and out-of-range keys", () => {
  const options = {
    connectionName: "route",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.15,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -2, y: 0, z: 0 },
    B: { x: 2, y: 0, z: 0 },
    availableZ: [0, 1],
    futureConnections: [{
      connectionName: "future",
      points: [{ x: -0.5, y: -1, z: 0 }, { x: 0.5, y: 1, z: 1 }],
    }],
  }
  const parent: Node = { x: -0.05, y: 0, z: 0, g: 1, h: 0, f: 0, parent: null }
  const node = { ...parent, x: 0, parent }
  const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(options)
  const storage = solver as unknown as CostStorage
  expect(storage.denseNodeCostTerms).toBeUndefined()
  solver.setNodeCosts(node)
  expect(Array.isArray(storage.denseNodeCostTerms)).toBe(true)
  expect(storage.denseNodeCostTerms!.length).toBeLessThanOrEqual(65_536)
  const firstEntry = storage.denseNodeCostTerms![solver.getNodeKey(node)]!
  expect(Object.hasOwn(firstEntry, "planarFuturePenalty")).toBe(true)
  expect(Object.hasOwn(firstEntry, "viaFuturePenalty")).toBe(true)
  expect(firstEntry.viaFuturePenalty).toBeUndefined()
  expect(storage.nodeCostTermsByGridKey.size).toBe(0)

  const outside = { ...node, x: 1e6 }
  solver.setNodeCosts(outside)
  expect(storage.nodeCostTermsByGridKey.has(solver.getNodeKey(outside))).toBe(true)
  solver.setNodeCosts(node)
  expect(storage.denseNodeCostTerms![solver.getNodeKey(node)]).toBe(firstEntry)

  const custom = new CustomKeySolver(options)
  const customNode = { ...node }
  custom.setNodeCosts(customNode)
  const customStorage = custom as unknown as CostStorage
  expect(customStorage.denseNodeCostTerms).toBeNull()
  expect(customStorage.nodeCostTermsByGridKey.has(custom.getNodeKey(customNode))).toBe(true)
  expect([customNode.g, customNode.h, customNode.f]).toEqual([node.g, node.h, node.f])

  const large = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
    ...options,
    bounds: { minX: -100, maxX: 100, minY: -100, maxY: 100 },
  })
  large.setNodeCosts({ ...node })
  const largeStorage = large as unknown as CostStorage
  expect(largeStorage.denseNodeCostTerms).toBeNull()
  expect(largeStorage.nodeCostTermsByGridKey.size).toBe(1)

  // A later custom key must never become a fractional array property.
  solver.getNodeKey = (candidate: Node): number => candidate.x + 0.25
  solver.setNodeCosts({ ...node })
  expect(storage.nodeCostTermsByGridKey.has(0.25)).toBe(true)
  expect(Object.hasOwn(storage.denseNodeCostTerms!, "0.25")).toBe(false)
  for (const key of [NaN, Infinity, -Infinity, -2, 65_536]) {
    solver.getNodeKey = (_candidate: Node): number => key
    const candidate = { ...node }
    solver.setNodeCosts(candidate)
    expect(storage.nodeCostTermsByGridKey.has(key)).toBe(true)
    expect([candidate.g, candidate.h, candidate.f]).toEqual([node.g, node.h, node.f])
  }
})
