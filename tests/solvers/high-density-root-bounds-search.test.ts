import { expect, test } from "bun:test"
import Flatbush from "flatbush"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("root bounds rejection preserves complete searches and avoids disjoint tree traversals", () => {
  let guardedTraversals = 0
  let referenceTraversals = 0
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
    const guarded = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(
      opts,
    )
    const reference = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(
      opts,
    )
    for (const [solver, isReference] of [
      [guarded, false],
      [reference, true],
    ] as const) {
      const indexes: Array<Flatbush | null> = [
        solver.obstacleSegmentIndex,
        solver.obstacleViaIndex,
        ...solver.obstacleSegmentIndexByLayer.values(),
      ]
      for (const index of indexes) {
        if (!index) continue
        const levelBounds = index._levelBounds
        // Flatbush reads this only when executing its original search body;
        // the guard reads the stored root directly without touching it.
        Object.defineProperty(index, "_levelBounds", {
          get(): number[] {
            if (isReference) referenceTraversals++
            else guardedTraversals++
            return levelBounds
          },
        })
        if (isReference) {
          const search = index.search.bind(index)
          // A custom search must always be called, bypassing the new guard.
          index.search = (...args: Parameters<typeof search>): number[] => {
            const result = search(...args)
            return result
          }
        }
      }
    }
    guarded.solve()
    reference.solve()
    expect({
      solved: guarded.solved,
      failed: guarded.failed,
      error: guarded.error,
      route: guarded.solvedPath,
      iterations: guarded.iterations,
      explored: guarded.debug_exploredNodesOrdered,
      blocked: [...guarded.debug_nodesTooCloseToObstacle],
      intersected: [...guarded.debug_nodePathToParentIntersectsObstacle],
      exploredKeys: [...guarded.exploredNodes],
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
    })
  }
  expect(referenceTraversals).toBeGreaterThan(0)
  expect(guardedTraversals).toBeLessThan(referenceTraversals / 4)
})
