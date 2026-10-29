import { test } from "bun:test"
import assert from "node:assert/strict"
import { HighDensityForceImproveSolver, runForceDirectedImprovement } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import {
  createSparseForceIndexReuseStats,
  createSparseForceStats,
  runSparseForceDirectedImprovement,
  SparseHighDensityForceImproveSolver,
} from "lib/solvers/SparseForceImproveSolver/SparseHighDensityForceImproveSolver"
import {
  createSparseForceDifferentialCases,
  type SparseForceRoute,
} from "tests/fixtures/createSparseForceDifferentialCases"

test("full native segment indexes reuse only unchanged geometry and preserve every returned numeric bit", () => {
  const bounds = { minX: 0, maxX: 10, minY: 0, maxY: 10 }
  const route = (name: string, points: number[][]): SparseForceRoute => ({
    connectionName: name,
    rootConnectionName: name,
    regionId: "sample",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: points.map(([x, y, z = 0]) => ({ x, y, z })),
    vias: [],
  })
  const middle = route("a", [[1, 5], [2, 5], [5, 5], [8, 5], [9, 5]])
  const cancellation = [
    middle,
    route("b", [[1, 4.9], [9, 4.9]]),
    route("c", [[1, 5.1], [9, 5.1]]),
  ]
  const clampSeed = [
    route("first", [[1, 9], [9, 9]]),
    route("a", [[1, 0], [2, 0], [5, 0], [8, 0], [9, 0]]),
    route("b", [[1, 0], [9, 0]]),
  ]
  const cases = [
    ...createSparseForceDifferentialCases(),
    { name: "positive-cancelled-constraints", routes: cancellation },
    { name: "pass-dependent-clamp-seed", routes: clampSeed },
  ]
  for (const item of cases) {
    for (const steps of [0, 1, 12, 20, 1.5, -1]) {
      for (const includeForceVectors of [true, false]) {
        const before = structuredClone(item.routes)
        const stats = createSparseForceStats()
        const reuse = createSparseForceIndexReuseStats()
        const actual = runSparseForceDirectedImprovement(bounds, item.routes, steps, {
          includeForceVectors, stats, indexReuseStats: reuse,
        })
        assert.deepStrictEqual(actual, runForceDirectedImprovement(bounds, item.routes, steps, { includeForceVectors }), `${item.name}/${steps}/${includeForceVectors}`)
        assert.deepStrictEqual(item.routes, before)
        assert.equal(stats.spatialIndexBuilds + reuse.indexReuses, reuse.indexRequests)
        assert.equal(reuse.kernelCachesCreated, stats.allFixedCalls ? 0 : 1)
      }
    }
  }

  const cancelledStats = createSparseForceStats()
  const cancelledReuse = createSparseForceIndexReuseStats()
  runSparseForceDirectedImprovement(bounds, cancellation, 0, {
    stats: cancelledStats, indexReuseStats: cancelledReuse,
  })
  assert.equal(cancelledStats.projectionPassesExecuted, 8)
  assert.equal(cancelledStats.inactiveProjectionExits, 0)
  assert.equal(cancelledStats.spatialIndexBuilds, 1)
  assert.equal(cancelledReuse.indexReuses, 7)
  assert.equal(cancelledReuse.nodeCoordinateChanges, 0)

  const clampStats = createSparseForceStats()
  const clampReuse = createSparseForceIndexReuseStats()
  const clamped = runSparseForceDirectedImprovement(bounds, clampSeed, 0, {
    stats: clampStats, indexReuseStats: clampReuse,
  })
  assert.equal(clampStats.projectionPassesExecuted, 8)
  assert.ok(clampReuse.clampCoordinateChanges > 0)
  assert.ok(clampReuse.indexInvalidations > 0)
  assert.ok(clamped.routes[1]!.route[2]!.y > 0)

  // No cache survives a kernel call. Changed owners, layers, protected point
  // membership, segment order, and coordinates all start with a fresh full tree.
  const sharedReuse = createSparseForceIndexReuseStats()
  const sharedStats = createSparseForceStats()
  const variants = [
    cancellation,
    cancellation.map((r) => ({ ...r, rootConnectionName: "common" })),
    cancellation.map((r, i) => ({ ...r, route: r.route.map((p) => ({ ...p, z: i % 2 })) })),
    [...cancellation].reverse(),
    cancellation.map((r) => ({ ...r, route: r.route.filter((_, i) => i !== 1) })),
  ]
  for (const input of variants) {
    const beforeCaches = sharedReuse.kernelCachesCreated
    const beforeBuilds = sharedStats.spatialIndexBuilds
    const beforeFixed = sharedStats.allFixedCalls
    assert.deepStrictEqual(
      runSparseForceDirectedImprovement(bounds, input, 0, { stats: sharedStats, indexReuseStats: sharedReuse }),
      runForceDirectedImprovement(bounds, input, 0),
    )
    const fixed = sharedStats.allFixedCalls > beforeFixed
    assert.equal(sharedReuse.kernelCachesCreated - beforeCaches, fixed ? 0 : 1)
    assert.ok(fixed || sharedStats.spatialIndexBuilds > beforeBuilds)
  }

  for (const [minX, maxX, minY, maxY] of [
    [-0, 10, -0, 10], [-1e-300, 1e-300, -1e-300, 1e-300],
    [0, 0, 0, 0], [-0, 0, -0, 0], [-5, 5, 0, 0],
  ]) {
    const edgeBounds = { minX, maxX, minY, maxY }
    for (const input of [cases[5]!.routes, cancellation, clampSeed]) {
      for (const steps of [0, 1, 20]) {
        assert.deepStrictEqual(
          runSparseForceDirectedImprovement(edgeBounds, input, steps),
          runForceDirectedImprovement(edgeBounds, input, steps),
        )
      }
    }
  }

  for (const item of cases) {
    const input = {
      nodeWithPortPoints: [{ capacityMeshNodeId: "sample", center: { x: 5, y: 5 }, width: 10, height: 10, availableZ: [0, 1], portPoints: [] }],
      hdRoutes: item.routes,
      totalStepsPerNode: 12,
      colorMap: { a: "#ff4400", b: "#4488aa" },
    }
    const native = new HighDensityForceImproveSolver(input)
    const cached = new SparseHighDensityForceImproveSolver(input)
    native.solve()
    cached.solve()
    assert.deepStrictEqual(cached.getOutput(), native.getOutput(), item.name)
    assert.deepStrictEqual(cached.latestVisualization, native.latestVisualization)
    assert.deepStrictEqual(cached.visualize(), native.visualize())
    assert.deepStrictEqual(cached.stats, native.stats)
    assert.equal(cached.iterations, native.iterations)
    assert.equal(cached.solved, native.solved)
    assert.equal(cached.failed, native.failed)
    assert.deepStrictEqual(cached.getConstructorParams(), native.getConstructorParams())
  }
})
