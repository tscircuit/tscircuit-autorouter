import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { precomputeIntraNodeRouteParams } from "lib/solvers/HighDensitySolver/precomputeIntraNodeRouteParams"
import { createFuturePointDistancePruningStats, registerOwnedFuturePointDistancePruningOptions } from "lib/solvers/HighDensitySolver/futurePointDistancePruningContext"
import { makeFuturePointOptions, makeFutureDistancePruningNode } from "./fixtures/futurePointDistancePruningSynthetic"

test("owned input cloning is isolated and distance-pruning admission reads no future coordinate getters", () => {
  const node = makeFutureDistancePruningNode(2)
  const precomputed = precomputeIntraNodeRouteParams(node)
  class Exposed extends IntraNodeRouteSolver {
    options() { return this.getSingleRouteSolverOpts(this.unsolvedConnections.pop()!) }
  }
  const owner = new Exposed({ nodeWithPortPoints: node, precomputedIntraNodeRouteParams: precomputed, experimentFuturePointDistancePruning: true })
  const opts = owner.options()
  const before = structuredClone(opts.futureConnections)
  for (const p of node.portPoints) { p.x = 100; p.y = -100 }
  for (const points of precomputed.connectionPointsByName.values()) for (const p of points) { p.x = -100; p.y = 100 }
  expect(opts.futureConnections).toEqual(before)
  for (const authorized of [false, true]) {
    let reads = 0
    const stats = createFuturePointDistancePruningStats()
    const options = makeFuturePointOptions(8)
    for (const p of options.futureConnections![0].points) Object.defineProperty(p, "x", { get() { reads++; return 0 } })
    if (authorized) registerOwnedFuturePointDistancePruningOptions(options, stats)
    const solver = new Native(options)
    expect(reads).toBe(0)
    expect(stats.instances).toBe(authorized ? 1 : 0)
    expect(solver.futureConnectionPoints).toHaveLength(8)
  }
})
