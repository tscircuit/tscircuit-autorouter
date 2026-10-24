import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Future } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { referenceGetNeighbors } from "./referenceSingleRouteNeighbors"

class LayerDependentSolver extends Future {
  calls: Node[] = []
  override isNodeTooCloseToObstacle(node: Node, margin?: number, via?: boolean): boolean {
    if (via) this.calls.push(node)
    return Boolean(via && node.z === 2) || super.isNodeTooCloseToObstacle(node, margin, via)
  }
}

class CustomKeySolver extends SingleHighDensityRouteSolver {
  keyNodes: Node[] = []
  override getNodeKey(node: Node): number {
    this.keyNodes?.push(node)
    return super.getNodeKey(node)
  }
}

test("custom layer predicates and key methods keep native calls and retained identities", (): void => {
  const options = {
    connectionName: "route", obstacleRoutes: [], minDistBetweenEnteringPoints: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -2, y: -2, z: 0 }, B: { x: 2, y: 2, z: 3 },
    availableZ: [0, 1, 2, 3], layerCount: 4,
    futureConnections: [{ connectionName: "future", points: [{ x: -1, y: 1, z: 0 }, { x: 1, y: 1, z: 1 }] }],
  }
  const node: Node = { x: 0, y: 0, z: 0, g: 1, h: 2, f: 3, parent: null }
  for (const Solver of [LayerDependentSolver, CustomKeySolver]) {
    const actual = new Solver(options)
    const reference = new Solver(options)
    const excluded = { ...node, x: -actual.cellStep, y: -actual.cellStep }
    actual.exploredNodes.add(actual.getNodeKey(excluded))
    reference.exploredNodes.add(reference.getNodeKey(excluded))
    expect((actual as any).canShareViaClearanceAcrossLayers()).toBe(false)
    expect(actual.getNeighbors(node)).toEqual(referenceGetNeighbors.call(reference, node))
    expect([...actual.exploredNodes]).toEqual([...reference.exploredNodes])
    if (actual instanceof LayerDependentSolver && reference instanceof LayerDependentSolver) {
      expect(actual.calls.map(n => n.z)).toEqual([1, 2, 3])
      expect(actual.calls).toEqual(reference.calls)
      expect(new Set(actual.calls).size).toBe(3)
    }
    if (actual instanceof CustomKeySolver && reference instanceof CustomKeySolver) {
      expect(actual.keyNodes).toEqual(reference.keyNodes)
      expect(new Set(actual.keyNodes).size).toBe(actual.keyNodes.length)
    }
  }
  const actual = new Future(options)
  const reference = new Future(options)
  for (const solver of [actual, reference]) {
    const native = solver.setNodeCosts.bind(solver)
    solver.setNodeCosts = (n: Node): void => {
      native(n)
      if (n.z !== n.parent?.z) solver.obstacleMargin += 0.01
    }
  }
  expect((actual as any).canShareViaClearanceAcrossLayers()).toBe(false)
  expect(actual.getNeighbors(node)).toEqual(referenceGetNeighbors.call(reference, node))
  expect(actual.obstacleMargin).toBe(reference.obstacleMargin)
})
