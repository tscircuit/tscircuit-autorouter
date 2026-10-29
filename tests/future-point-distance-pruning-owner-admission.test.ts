import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { createFuturePointDistancePruningStats, registerOwnedFuturePointDistancePruningOptions } from "lib/solvers/HighDensitySolver/futurePointDistancePruningContext"
import { makeFuturePointOptions, queryNode, makeFutureDistancePruningNode } from "./fixtures/futurePointDistancePruningSynthetic"

const expectPublicLegacyEviction = (solver: Native): void => {
  const q = queryNode(0, 0, 0), q2 = queryNode(1, 1, 0)
  const key = 256
  solver.getNodeKey = (node) => node.x === 0 ? 0 : key
  solver.futureConnectionPoints = [{ x: 0, y: 0, z: 0 }, { x: .01, y: 0, z: 0 }, ...Array.from({ length: 6 }, (_, i) => ({ x: 5 + i, y: 5, z: 0 }))]
  expect(solver.getClosestFutureConnectionPoint(q)).toBe(solver.futureConnectionPoints[0])
  solver.getClosestFutureConnectionPoint(q2)
  solver.futureConnectionPoints[0]!.x = 100
  expect(solver.getClosestFutureConnectionPoint(q)).toBe(solver.futureConnectionPoints[1])
}

test("copied, replayed, forged and overridden public options retain exact native mutable-cache eviction behavior", () => {
  const stats = createFuturePointDistancePruningStats()
  const original = makeFuturePointOptions(8)
  registerOwnedFuturePointDistancePruningOptions(original, stats)
  expectPublicLegacyEviction(new Native({ ...original }))
  expect(stats.instances).toBe(0)
  const authorized = new Native(original)
  expect(stats.instances).toBe(1)
  expectPublicLegacyEviction(new Native(original))
  const replaced = makeFuturePointOptions(8)
  registerOwnedFuturePointDistancePruningOptions(replaced, stats)
  replaced.futureConnections = makeFuturePointOptions(8, 7).futureConnections
  expectPublicLegacyEviction(new Native(replaced))
  const forged = { ...makeFuturePointOptions(8), experimentFuturePointDistancePruning: true, ownedFuturePointCache: true, futurePointDistancePruningStats: stats, hyperParameters: { futurePointDistancePruningStats: stats } }
  expectPublicLegacyEviction(new Native(forged as any))
  expect(stats.instances).toBe(1)
  class Overridden extends IntraNodeRouteSolver {
    protected override getSingleRouteSolverOpts(connection: any) {
      const opts = super.getSingleRouteSolverOpts(connection)
      opts.futureConnections = makeFuturePointOptions(8).futureConnections
      return opts
    }
    createPublicOptions() {
      const connection = this.unsolvedConnections.pop()!
      return this.getSingleRouteSolverOpts(connection)
    }
  }
  const owner = new Overridden({ nodeWithPortPoints: makeFutureDistancePruningNode(), experimentFuturePointDistancePruning: true, futurePointDistancePruningStats: stats })
  expectPublicLegacyEviction(new Native(owner.createPublicOptions()))
  expect(stats.instances).toBe(1)
  expect(stats.contextsPruned).toBe(0)
  expect(authorized.futureConnectionPoints).toHaveLength(8)
  for (const count of [0, 2, 7]) {
    const smallStats = createFuturePointDistancePruningStats()
    const opts = makeFuturePointOptions(count)
    registerOwnedFuturePointDistancePruningOptions(opts, smallStats)
    const small = new Native(opts)
    const reference = new Native(opts)
    for (const node of [queryNode(0, 0, 0), queryNode(1, 1, 1), queryNode(-1, -1, 2)]) expect(small.getClosestFutureConnectionPoint(node)).toBe(reference.getClosestFutureConnectionPoint(node))
    expect(smallStats.instances).toBe(0)
    expect(smallStats.contextsPruned).toBe(0)
  }
})
