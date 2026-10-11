import { expect, test } from "bun:test"
import { DeferredHighDensityRouteCostMemo } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/DeferredHighDensityRouteCostMemo"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as GridSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

type ClosestState = {
  closestFuturePointCacheCoordinates: Float64Array
  closestFuturePointCacheIndices: Int32Array
  cachedFutureConnectionPointCount: number
}

test("lazy HD math storage activates between batches without resetting native selectors or mutable costs", (): void => {
  const options: ConstructorParameters<typeof GridSolver>[0] = {
    connectionName: "signal", obstacleRoutes: [], minDistBetweenEnteringPoints: 0.1,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    A: { x: -8, y: -7, z: 0 }, B: { x: 8, y: 7, z: 1 }, layerCount: 2,
    futureConnections: [{ connectionName: "future", points: [
      { x: 0.1, y: 0.2, z: 0 }, { x: 1, y: 0.2, z: 0 }, { x: -0.5, y: 0.9, z: 1 },
    ] }], captureSearchDebug: true,
  }
  const native = new GridSolver(structuredClone(options))
  const deferred = new GridSolver(structuredClone(options))
  const originalCosts = GridSolver.prototype.setNodeCosts
  const memo = new DeferredHighDensityRouteCostMemo(deferred)
  expect(deferred.setNodeCosts).toBe(originalCosts)
  for (let batch = 0; batch < 100; batch++) {
    for (const solver of [native, deferred]) {
      if (batch % 5 === 0) {
        solver.B.y -= 0.01
        solver.VIA_PENALTY_FACTOR += 0.01
      }
      if (batch === 70) solver.futureConnectionPoints[0]!.x = 20
      if (batch === 71) solver.futureConnectionPoints = []
      if (batch === 72) solver.futureConnectionPoints = structuredClone(options.futureConnections![0]!.points)
      if (batch === 73) solver.futureConnectionPoints.reverse()
    }
    const activeMemo = memo.beginNeighborBatch()
    let completedNativeCalls = 0
    expect(deferred.setNodeCosts === originalCosts).toBe(batch < 64)
    try {
      for (let point = 0; point < 8; point++) {
        const parent: Node = { x: -0.1, y: 0.2, z: point % 2, g: batch * 0.3, h: 0, f: 0, parent: null }
        const query: Node = { x: (point % 4) * 0.1, y: batch % 3 * 0.1,
          z: point % 2, g: 0, h: 0, f: 0, parent }
        const expected = structuredClone(query), actual = structuredClone(query)
        native.setNodeCosts(expected)
        if (activeMemo) activeMemo.setNodeCosts(actual, deferred.getNodeKey(actual))
        else { deferred.setNodeCosts(actual); completedNativeCalls++ }
        expect(Object.is(actual.g, expected.g)).toBe(true)
        expect(Object.is(actual.h, expected.h)).toBe(true)
        expect(Object.is(actual.f, expected.f)).toBe(true)
        // Reaching 512 successful calls does not mutate a live batch's policy.
        if (batch === 63) expect(deferred.setNodeCosts).toBe(originalCosts)
      }
    } finally { memo.endNeighborBatch(completedNativeCalls) }
    const a = native as unknown as ClosestState, b = deferred as unknown as ClosestState
    expect(b.closestFuturePointCacheCoordinates).toEqual(a.closestFuturePointCacheCoordinates)
    expect(b.closestFuturePointCacheIndices).toEqual(a.closestFuturePointCacheIndices)
    expect(b.cachedFutureConnectionPointCount).toBe(a.cachedFutureConnectionPointCount)
  }
  const fresh = new GridSolver(structuredClone(options))
  const guarded = new DeferredHighDensityRouteCostMemo(fresh)
  const parent: Node = { x: 0, y: 0, z: 0, g: 0, h: 0, f: 0, parent: null }
  const query: Node = { ...parent, x: 0.1, parent }
  const customPenalty = (): number => 5
  fresh.getFutureConnectionPenalty = customPenalty
  for (let call = 0; call < 512; call++) fresh.setNodeCosts({ ...query })
  guarded.endNeighborBatch(512)
  guarded.beginNeighborBatch()
  guarded.endNeighborBatch(0)
  expect(fresh.setNodeCosts).toBe(originalCosts)
  fresh.getFutureConnectionPenalty = GridSolver.prototype.getFutureConnectionPenalty
  guarded.beginNeighborBatch()
  guarded.endNeighborBatch(0)
  expect(fresh.setNodeCosts).not.toBe(originalCosts)
  const tiny = new GridSolver(structuredClone(options))
  const tinyMemo = new DeferredHighDensityRouteCostMemo(tiny)
  for (let call = 0; call < 16; call++) tiny.setNodeCosts({ ...query })
  tinyMemo.endNeighborBatch(16)
  tinyMemo.beginNeighborBatch()
  tinyMemo.endNeighborBatch(0)
  expect(tiny.setNodeCosts).toBe(originalCosts)
  expect(() => new DeferredHighDensityRouteCostMemo(tiny, -1)).toThrow()
})
