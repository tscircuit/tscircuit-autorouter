import { expect, test } from "bun:test"
import { distance, pointToSegmentDistance } from "@tscircuit/math-utils"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

let referencePlanarCalls = 0
let candidatePlanarCalls = 0

class IndividualViaQuerySolver extends SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost {
  override isNodeTooCloseToObstacle(
    node: Node,
    margin?: number,
    isVia?: boolean,
    planarObstacleQuery?: Parameters<
      SingleHighDensityRouteSolver["isNodeTooCloseToObstacle"]
    >[3],
  ): boolean {
    if (!isVia) referencePlanarCalls++
    if (
      this.uncachedObstacleClearance(node, margin, isVia, planarObstacleQuery)
    ) {
      return true
    }
    return Boolean(isVia && this.isViaTooCloseToFutureConnectionTrace(node))
  }

  // Independent reference: the original static obstacle checks and return order.
  uncachedObstacleClearance(
    node: Node,
    margin?: number,
    isVia?: boolean,
    planarObstacleQuery?: Parameters<
      SingleHighDensityRouteSolver["isNodeTooCloseToObstacle"]
    >[3],
  ): boolean {
    margin ??= this.obstacleMargin

    if (isVia && node.parent) {
      const viasInMyRoute = this.getViasInNodePath(node.parent)
      for (const via of viasInMyRoute) {
        if (distance(node, via) < this.viaDiameter / 2 + margin) {
          return true
        }
      }
    }

    const traceProximity = this.traceThickness + margin
    const indexedSegments =
      planarObstacleQuery?.segments ??
      (!isVia
        ? this.obstacleSegmentsByLayer.get(node.z)
        : this.obstacleSegments)
    const nearbySegmentIds =
      planarObstacleQuery?.segmentIds ??
      (!isVia
        ? this.obstacleSegmentIndexByLayer.get(node.z)
        : this.obstacleSegmentIndex
      )?.search(
        node.x - traceProximity,
        node.y - traceProximity,
        node.x + traceProximity,
        node.y + traceProximity,
      ) ??
      []
    if (indexedSegments) {
      for (const segmentId of nearbySegmentIds) {
        const segment = indexedSegments[segmentId]
        if (!segment || segment.connectedToCurrentConnection) continue
        if (!isVia && segment.z !== node.z) continue
        if (
          planarObstacleQuery &&
          (node.x + traceProximity < segment.minX ||
            node.y + traceProximity < segment.minY ||
            node.x - traceProximity > segment.maxX ||
            node.y - traceProximity > segment.maxY)
        ) {
          continue
        }
        if (
          pointToSegmentDistance(node, segment.A, segment.B) < traceProximity
        ) {
          return true
        }
      }
    }

    const viaProximity = this.viaDiameter / 2 + this.traceThickness / 2 + margin
    if (this.obstacleViaIndex) {
      const nearbyViaIds = this.obstacleViaIndex.search(
        node.x - viaProximity,
        node.y - viaProximity,
        node.x + viaProximity,
        node.y + viaProximity,
      )
      for (const viaId of nearbyViaIds) {
        const via = this.obstacleVias[viaId]
        if (via && distance(node, via) < viaProximity) {
          return true
        }
      }
    }

    return false
  }
}

test("fixed geometry planar cache preserves 24 complete search states and reduces actual clearance calls", () => {
  const prototype = SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost.prototype
  const original = prototype.isNodeTooCloseToObstacle
  prototype.isNodeTooCloseToObstacle = function (...args: Parameters<typeof original>): boolean {
    if (!args[2]) candidatePlanarCalls++
    return original.apply(this, args)
  }
  try {
  let seed = 71329
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
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
        route: [
          { x: -1.42, y: -1.7, z: 0 },
          { x: -1.42, y: 1.7, z: 0 },
        ],
        vias: [],
      })
    }
    const opts = {
      connectionName: "route",
      obstacleRoutes,
      minDistBetweenEnteringPoints: 0.15,
      bounds,
      A:
        sample % 8 === 0
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
          points: [
            { x: 0, y: bounds.minY, z: 0 },
            { x: 0, y: bounds.maxY, z: 1 },
          ],
        },
        {
          connectionName: "future-b",
          points: [
            { x: -0.41, y: -1, z: 0 },
            { x: 0.73, y: 1, z: layerCount - 1 },
          ],
        },
      ],
    }
    const shared = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(
      { ...opts, fixedObstacleGeometry: true },
    )
    // Explicit test-only eligibility for a transparent counting wrapper.
    // Production eligibility remains pinned to the original implementation.
    ;(shared as unknown as { planarClearanceMethod: typeof original }).planarClearanceMethod = prototype.isNodeTooCloseToObstacle
    const reference = new IndividualViaQuerySolver(opts)
    if (shared.candidates.peek()!.parent === null) {
      exactStartCases++
      expect(shared.candidates.peek()!.x).toBe(opts.A.x)
      expect(shared.candidates.peek()!.y).toBe(opts.A.y)
    }
    shared.solve()
    reference.solve()
    expect({
      solved: shared.solved,
      failed: shared.failed,
      iterations: shared.iterations,
      route: shared.solvedPath,
      explored: shared.debug_exploredNodesOrdered,
      exploredSet: [...shared.exploredNodes],
      queue: (shared.candidates as unknown as { heap: Node[] }).heap.map(({ x, y, z, f, g, h }) => ({ x, y, z, f, g, h })),
      blocked: [...shared.debug_nodesTooCloseToObstacle],
      intersected: [...shared.debug_nodePathToParentIntersectsObstacle],
    }).toEqual({
      solved: reference.solved,
      failed: reference.failed,
      iterations: reference.iterations,
      route: reference.solvedPath,
      explored: reference.debug_exploredNodesOrdered,
      exploredSet: [...reference.exploredNodes],
      queue: (reference.candidates as unknown as { heap: Node[] }).heap.map(({ x, y, z, f, g, h }) => ({ x, y, z, f, g, h })),
      blocked: [...reference.debug_nodesTooCloseToObstacle],
      intersected: [...reference.debug_nodePathToParentIntersectsObstacle],
    })
  }
  expect(exactStartCases).toBeGreaterThanOrEqual(3)
  expect(candidatePlanarCalls).toBeLessThan(referencePlanarCalls * 0.4)
  } finally {
    prototype.isNodeTooCloseToObstacle = original
  }
})
