import { expect, test } from "bun:test"
import { distance } from "@tscircuit/math-utils"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

class UncachedFutureCostSolver extends SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost {
  // Preserve the original calculation order as the independent reference.
  override setNodeCosts(node: Node): void {
    const dx = Math.abs(node.x - node.parent!.x)
    const dy = Math.abs(node.y - node.parent!.y)
    const dist = Math.sqrt(dx ** 2 + dy ** 2)
    const isEvenLayer = node.z % 2 === 0
    const misalignedDist = !this.FLIP_TRACE_ALIGNMENT_DIRECTION
      ? isEvenLayer ? dy : dx
      : isEvenLayer ? dx : dy
    const baseG =
      (node.parent?.g ?? 0) +
      (node.z === node.parent?.z ? 0 : this.viaPenaltyDistance) +
      dist +
      misalignedDist * this.MISALIGNED_DIST_PENALTY_FACTOR
    const goalDist = distance(node, this.B) ** 1.6
    const baseH = goalDist + (node.z !== this.B.z ? this.viaPenaltyDistance : 0)
    const futurePenalty = this.getFutureConnectionPenalty(
      node,
      node.z !== node.parent?.z,
    )
    node.g = baseG + futurePenalty
    node.h = baseH + futurePenalty
    node.f = this.computeF(node.g, node.h)
  }
}

test("memoized costs preserve full searches across exact starts, bounds and layers", () => {
  let seed = 71329
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
  let memoizedCalculations = 0
  let referenceCalculations = 0
  let repeatedCoordinateSavings = 0
  let exactStartCases = 0
  for (let sample = 0; sample < 24; sample++) {
    const layerCount = sample % 4 === 0 ? 4 : 2
    const offset = sample % 3 === 0 ? 0.00000000000007 : 0
    const bounds = {
      minX: -2 + offset,
      maxX: 2.013 + offset,
      minY: -2.007 - offset,
      maxY: 2.019 - offset,
    }
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
    if (sample % 8 === 0) {
      // The rounded x=-1.125 is too close to this obstacle; the exact
      // x=-1.113 is outside its clearance and must seed the search unchanged.
      obstacleRoutes.push({
        connectionName: "exact-start-obstacle",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [{ x: -1.42, y: -1.7, z: 0 }, { x: -1.42, y: 1.7, z: 0 }],
        vias: [],
      })
    }
    const opts = {
      connectionName: "route",
      obstacleRoutes,
      minDistBetweenEnteringPoints: 0.15,
      bounds,
      A: sample % 8 === 0
        ? { x: -1.113, y: -0.737, z: 0 }
        : { x: bounds.minX, y: -0.753 + random() * 1.5, z: 0 },
      B: { x: bounds.maxX, y: -0.731 + random() * 1.5, z: sample % layerCount },
      layerCount,
      availableZ: Array.from({ length: layerCount }, (_, z) => z),
      hyperParameters: {
        CELL_SIZE_FACTOR: sample % 2 === 0 ? 0.5 : 1,
        FLIP_TRACE_ALIGNMENT_DIRECTION: sample % 3 === 0,
      },
      futureConnections: [
        {
          connectionName: "future-a",
          points: [{ x: 0, y: bounds.minY, z: 0 }, { x: 0, y: bounds.maxY, z: 1 }],
        },
        {
          connectionName: "future-b",
          points: [{ x: -0.41, y: -1, z: 0 }, { x: 0.73, y: 1, z: layerCount - 1 }],
        },
      ],
    }
    const memoized = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(opts)
    const reference = new UncachedFutureCostSolver(opts)
    if (memoized.candidates.peek()!.parent === null) {
      exactStartCases++
      expect(memoized.candidates.peek()!.x).toBe(opts.A.x)
      expect(memoized.candidates.peek()!.y).toBe(opts.A.y)
    }
    const memoizedPenalty = memoized.getFutureConnectionPenalty.bind(memoized)
    const referencePenalty = reference.getFutureConnectionPenalty.bind(reference)
    let sampleMemoizedCalculations = 0
    let sampleReferenceCalculations = 0
    memoized.getFutureConnectionPenalty = (node: Node, isVia: boolean): number => {
      sampleMemoizedCalculations++
      const penalty = memoizedPenalty(node, isVia)
      memoizedCalculations++
      return penalty
    }
    reference.getFutureConnectionPenalty = (node: Node, isVia: boolean): number => {
      sampleReferenceCalculations++
      const penalty = referencePenalty(node, isVia)
      referenceCalculations++
      return penalty
    }
    memoized.solve()
    reference.solve()
    if (sampleMemoizedCalculations < sampleReferenceCalculations) {
      repeatedCoordinateSavings++
    }
    expect({
      solved: memoized.solved,
      failed: memoized.failed,
      iterations: memoized.iterations,
      route: memoized.solvedPath,
      explored: memoized.debug_exploredNodesOrdered,
      blocked: [...memoized.debug_nodesTooCloseToObstacle],
      intersected: [...memoized.debug_nodePathToParentIntersectsObstacle],
    }).toEqual({
      solved: reference.solved,
      failed: reference.failed,
      iterations: reference.iterations,
      route: reference.solvedPath,
      explored: reference.debug_exploredNodesOrdered,
      blocked: [...reference.debug_nodesTooCloseToObstacle],
      intersected: [...reference.debug_nodePathToParentIntersectsObstacle],
    })
  }
  expect(exactStartCases).toBeGreaterThanOrEqual(3)
  expect(repeatedCoordinateSavings).toBeGreaterThanOrEqual(20)
  expect(memoizedCalculations).toBeLessThan(referenceCalculations * 0.8)
})
