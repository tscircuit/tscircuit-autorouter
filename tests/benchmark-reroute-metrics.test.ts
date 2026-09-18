import { expect, test } from "bun:test"
import { extractRerouteMetrics } from "../scripts/benchmark/extract-reroute-metrics"

test("reroute metrics preserve counts and scores without inventing missing data", () => {
  const stats = {
    rerouteAttempts: 6,
    acceptedReroutes: 4,
    reroutedRouteCount: 3,
    initialMaxRegionCost: 0.4,
    finalMaxRegionCost: 0.1,
    initialTotalRegionCost: 0.5,
    finalTotalRegionCost: 0.3,
  }
  expect(extractRerouteMetrics(stats)).toEqual(stats)
  expect(extractRerouteMetrics(undefined)).toBeUndefined()
  expect(extractRerouteMetrics({})).toBeUndefined()
  expect(() =>
    extractRerouteMetrics({ ...stats, finalMaxRegionCost: undefined }),
  ).toThrow("Invalid tiny-hypergraph reroute metric: finalMaxRegionCost")
})
