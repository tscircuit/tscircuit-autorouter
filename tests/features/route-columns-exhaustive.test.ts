import { expect, test } from "bun:test"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { columnPool, columnRoute } from "../fixtures/routeColumnPoolFixtures"

test("bounded compatibility selection agrees with exhaustive assignments on every subset of a tiny route universe", (): void => {
  const universe = [-2, 0, 2].map((y, net) => [
    columnRoute(String(net), [{ x: -4, y, z: 0 }, { x: 4, y, z: 0 }]),
    columnRoute(String(net), [
      { x: -4, y, z: 0 }, { x: -3, y: -y, z: 0 },
      { x: 3, y: -y, z: 0 }, { x: 4, y, z: 0 },
    ]),
  ])
  for (let mask = 0; mask < 64; mask++) {
    const candidates = universe.map((routes, net) => routes.filter((_, choice) => (mask & (1 << (net * 2 + choice))) !== 0))
    const selected: HighDensityIntraNodeRoute[] = []
    const oracle = (net: number): boolean => {
      if (net === candidates.length) return true
      for (const route of candidates[net]!) {
        if (selected.some((previous) => doPipeline9RoutesHaveCopperConflict({
          left: route, right: previous, clearance: 0.1, layerCount: 4,
        }))) continue
        selected.push(route)
        if (oracle(net + 1)) return true
        selected.pop()
      }
      return false
    }
    const expected = oracle(0)
    const pool = columnPool(universe.map((routes) => routes[0]!))
    for (const [net, routes] of candidates.entries())
      for (const route of routes) pool.offerRoute(route, `donor-${net}`)
    expect(pool.exhausted).toBe(false)
    expect(Boolean(pool.solvedRoutes)).toBe(expected)
    if (pool.solvedRoutes) expect(pool.solvedRoutes.map((route) => route.connectionName)).toEqual(["0", "1", "2"])
  }
})
