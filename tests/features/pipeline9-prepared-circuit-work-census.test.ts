import { expect, test } from "bun:test"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { createPreparedRepairCircuitJsonConverter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPreparedRepairCircuitJsonConverter"
import { createPreparedRepairCircuitInput, createPreparedRepairCircuitStats } from "../fixtures/prepared-repair-circuit-input"

test("fixed candidate endpoints reuse exact containment and static context while every changed copper circuit stays native", (): void => {
  const { srj, traces } = createPreparedRepairCircuitInput(0)
  srj.connections = srj.connections.slice(0, 1)
  const stats = createPreparedRepairCircuitStats()
  const prepared = createPreparedRepairCircuitJsonConverter(srj, {}, stats)
  for (let iteration = 0; iteration < 100; iteration++) {
    const candidate = [structuredClone(traces[0]!)]
    const middle = candidate[0]!.route[1]!
    if ("y" in middle) middle.y = iteration / 100
    candidate[0]!.connectsTo = iteration % 2 ? ["point_0_0", "extra_net"] : ["root_0"]
    expect(prepared(candidate)).toEqual(convertToCircuitJson(srj, candidate))
  }
  expect(stats.conversions).toBe(100)
  expect(stats.contextBuilds).toBe(1)
  expect(stats.staticPadBuilds).toBe(1)
  expect(stats.staticPortBuilds).toBe(1)
  expect(stats.sourceResolverBuilds).toBe(1)
  expect(stats.routeResolverBuilds).toBe(1)
  expect(stats.sourceConnectivityBuilds).toBe(1)
  expect(stats.routeConnectivityBuilds).toBe(1)
  expect(stats.sourceConnectivityReuses).toBe(99)
  expect(stats.endpointQueries).toBe(200)
  expect(stats.endpointCacheMisses).toBe(2)
  expect(stats.endpointCacheHits).toBe(198)
  expect(stats.endpointObstacleTests).toBe(2 * srj.obstacles.length)
  expect(stats.endpointCacheEntries).toBe(2)
})
