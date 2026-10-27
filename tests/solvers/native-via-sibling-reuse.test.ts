import { expect, test } from "bun:test"
import Flatbush from "flatbush"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver as BaseNative } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

const makeSolver = (layers: number, enabled: boolean): Native => {
  const solver = new Native({
    connectionName: "current",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.2,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -1, y: 0, z: 0 },
    B: { x: 1, y: 0, z: layers - 1 },
    layerCount: layers,
    availableZ: Array.from({ length: layers }, (_, z) => z),
    captureSearchDebug: false,
    nativeViaSiblingClearance: enabled,
  })
  solver.exploredNodes.clear()
  return solver
}

test("via reuse is lazy, preserves each target and disables for changed hooks", (): void => {
  const root: Node = {
    x: 0,
    y: 0,
    z: 0,
    g: 0,
    h: 0,
    f: 0,
    parent: null,
  }
  for (const layers of [2, 4, 6]) {
    for (const closedTargets of [0, layers - 2, layers - 1]) {
      const results: Node[][] = []
      const calls: number[] = []
      for (const enabled of [false, true]) {
        const solver = makeSolver(layers, enabled)
        let queries = 0
        const index = new Flatbush(1)
        index.add(100, 100, 101, 101)
        index.finish()
        const search = index.search.bind(index)
        index.search = (...args: Parameters<Flatbush["search"]>): number[] => {
          queries++
          return search(...args)
        }
        solver.obstacleViaIndex = index
        for (let z = 1; z <= closedTargets; z++) {
          solver.exploredNodes.add(solver.getNodeKey({ ...root, z }))
        }
        results.push(solver.getNeighbors(root))
        calls.push(queries)
      }
      expect(results[1]).toEqual(results[0])
      const remainingTargets = layers - 1 - closedTargets
      expect(calls[0] - calls[1]).toBe(Math.max(0, remainingTargets - 1))
    }
  }

  for (const mutation of ["instance", "prototype", "base", "cost", "getter"]) {
    const originalObstacle = Native.prototype.isNodeTooCloseToObstacle
    const originalBaseObstacle = BaseNative.prototype.isNodeTooCloseToObstacle
    const outputs: Node[][] = []
    const calls: number[] = []
    try {
      for (const enabled of [false, true]) {
        const solver = makeSolver(6, enabled)
        let viaCalls = 0
        const changedObstacle: typeof originalObstacle = function (
          this: Native,
          node,
          margin,
          isVia,
          query,
        ): boolean {
          if (isVia) {
            viaCalls++
            return node.z % 2 === 0
          }
          return originalObstacle.call(this, node, margin, isVia, query)
        }
        if (mutation === "instance") {
          solver.isNodeTooCloseToObstacle = changedObstacle
        } else if (mutation === "prototype") {
          Native.prototype.isNodeTooCloseToObstacle = changedObstacle
        } else if (mutation === "base") {
          BaseNative.prototype.isNodeTooCloseToObstacle = function (
            node,
            margin,
            isVia,
            query,
          ): boolean {
            if (isVia) {
              viaCalls++
              return node.z % 2 === 0
            }
            return originalBaseObstacle.call(this, node, margin, isVia, query)
          }
        } else {
          const index = new Flatbush(1)
          index.add(100, 100, 101, 101)
          index.finish()
          const search = index.search.bind(index)
          index.search = (
            ...args: Parameters<Flatbush["search"]>
          ): number[] => {
            viaCalls++
            return search(...args)
          }
          solver.obstacleViaIndex = index
          if (mutation === "cost") {
            const originalCosts = solver.setNodeCosts
            solver.setNodeCosts = function (node): void {
              originalCosts.call(this, node)
              if (node.z !== root.z) this.obstacleMargin += 0.001
            }
          } else {
            Object.defineProperty(solver, "viaPenaltyDistance", {
              get: (): number => 0.5,
            })
          }
        }
        outputs.push(solver.getNeighbors(root))
        calls.push(viaCalls)
        Native.prototype.isNodeTooCloseToObstacle = originalObstacle
        BaseNative.prototype.isNodeTooCloseToObstacle = originalBaseObstacle
      }
    } finally {
      Native.prototype.isNodeTooCloseToObstacle = originalObstacle
      BaseNative.prototype.isNodeTooCloseToObstacle = originalBaseObstacle
    }
    expect(outputs[1]).toEqual(outputs[0])
    expect(calls[1]).toBe(calls[0])
    expect(calls[0]).toBeGreaterThan(1)
  }
})
