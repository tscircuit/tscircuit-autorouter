import { expect, test } from "bun:test"
import {
  type Node,
  SingleRouteCandidatePriorityQueue,
} from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

class OriginalHeapQueue extends SingleRouteCandidatePriorityQueue {
  override heapifyDown(): void {
    const state = this as unknown as { heap: Node[] }
    let index = 0
    const heapLength = state.heap.length
    const item = state.heap[index]
    if (!item) return
    while (true) {
      const leftChildIndex = 2 * index + 1
      if (leftChildIndex >= heapLength) break
      const rightChildIndex = leftChildIndex + 1
      let smallerChildIndex = leftChildIndex
      if (
        rightChildIndex < heapLength &&
        state.heap[rightChildIndex].f < state.heap[leftChildIndex].f
      ) {
        smallerChildIndex = rightChildIndex
      }
      if (item.f < state.heap[smallerChildIndex].f) break
      state.heap[index] = state.heap[smallerChildIndex]
      index = smallerChildIndex
    }
    state.heap[index] = item
  }
}

test("heap locals preserve complete search routes and expansion order", () => {
  let seed = 71329
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
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
    const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(
      opts,
    )
    const reference =
      new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(opts)
    const initialHeap = (reference.candidates as unknown as { heap: Node[] })
      .heap
    reference.candidates = new OriginalHeapQueue([])
    ;(reference.candidates as unknown as { heap: Node[] }).heap = initialHeap
    solver.solve()
    reference.solve()
    expect({
      solved: solver.solved,
      failed: solver.failed,
      error: solver.error,
      route: solver.solvedPath,
      iterations: solver.iterations,
      explored: solver.debug_exploredNodesOrdered,
      blocked: [...solver.debug_nodesTooCloseToObstacle],
      intersected: [...solver.debug_nodePathToParentIntersectsObstacle],
      exploredKeys: [...solver.exploredNodes],
      remainingCandidates: solver.candidates.getTopN(20),
    }).toEqual({
      solved: reference.solved,
      failed: reference.failed,
      error: reference.error,
      route: reference.solvedPath,
      iterations: reference.iterations,
      explored: reference.debug_exploredNodesOrdered,
      blocked: [...reference.debug_nodesTooCloseToObstacle],
      intersected: [...reference.debug_nodePathToParentIntersectsObstacle],
      exploredKeys: [...reference.exploredNodes],
      remainingCandidates: reference.candidates.getTopN(20),
    })
  }
})
