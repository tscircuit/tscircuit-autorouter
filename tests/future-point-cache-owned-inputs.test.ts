import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { precomputeIntraNodeRouteParams } from "lib/solvers/HighDensitySolver/precomputeIntraNodeRouteParams"
import { createFuturePointCacheStats, registerOwnedFuturePointCacheOptions } from "lib/solvers/HighDensitySolver/futurePointCacheContext"
import { makeFutureCacheNode, makeFuturePointOptions } from "./fixtures/futurePointCacheSynthetic"

test("owned futures survive original/precomputed input mutation while rich coordinates and callbacks stay legacy", () => {
  class Exposed extends IntraNodeRouteSolver {
    exposeOwnedOptions() {
      const current = this.unsolvedConnections.pop()!
      return this.getSingleRouteSolverOpts(current)
    }
  }
  const node = makeFutureCacheNode(2)
  const precomputed = precomputeIntraNodeRouteParams(node)
  const stats = createFuturePointCacheStats()
  const owner = new Exposed({ nodeWithPortPoints: node, precomputedIntraNodeRouteParams: precomputed, experimentFuturePointCache: true, futurePointCacheStats: stats })
  const expected = structuredClone(owner.unsolvedConnections)
  node.portPoints[0]!.x = 1000
  for (const points of precomputed.connectionPointsByName.values()) for (const point of points) point.y = -1000
  const opts = owner.exposeOwnedOptions()
  expect(opts.futureConnections).toEqual(expected.slice(0, -1))
  const single = new Native(opts)
  expect(stats.instances).toBe(1)
  for (const point of single.futureConnectionPoints) Object.freeze(point)
  Object.freeze(single.futureConnectionPoints)
  for (let step = 0; step < 200 && !single.solved && !single.failed; step++) single.step()
  expect(stats.lookups).toBeGreaterThan(0)
  expect(single.futureConnectionPoints).toEqual(expected.slice(0, -1).flatMap((connection) => connection.points))
  for (const bad of ["boxed", "callback"] as const) {
    const opts = makeFuturePointOptions(8)
    if (bad === "boxed") opts.futureConnections![0]!.points[0]!.x = new Number(3) as any
    else opts.hyperParameters = { getNodeKey: () => 0 } as any
    const rejected = createFuturePointCacheStats()
    registerOwnedFuturePointCacheOptions(opts, rejected)
    new Native(opts)
    expect(rejected.instances).toBe(0)
  }
})
