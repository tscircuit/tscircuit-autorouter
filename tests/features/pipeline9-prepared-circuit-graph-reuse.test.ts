import { expect, test } from "bun:test"
import { createPreparedRepairCircuitJsonConverter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPreparedRepairCircuitJsonConverter"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createPreparedRepairCircuitInput, createPreparedRepairCircuitStats } from "../fixtures/prepared-repair-circuit-input"

test("actual graph-reuse census credits repeated owned graphs and never supplied native connectivity maps", (): void => {
  const { srj, traces } = createPreparedRepairCircuitInput(0)
  for (const supplied of [false, true]) {
    const stats = createPreparedRepairCircuitStats()
    const options = supplied ? { connectivityMaps: {
      source: getConnectivityMapFromSimpleRouteJson(srj),
      route: getConnectivityMapFromSimpleRouteJson(srj),
    } } : {}
    const prepared = createPreparedRepairCircuitJsonConverter(srj, options, stats)
    expect(prepared(traces)).toEqual(convertToCircuitJson(srj, traces, options))
    expect(stats.sourceConnectivityReuses).toBe(0)
    const candidate = structuredClone(traces)
    const middle = candidate[0]!.route[1]!
    if ("x" in middle) middle.x += 0.001
    expect(prepared(candidate)).toEqual(convertToCircuitJson(srj, candidate, options))
    expect(stats.conversions).toBe(2)
    expect(stats.sourceConnectivityBuilds).toBe(supplied ? 0 : 1)
    expect(stats.sourceConnectivityReuses).toBe(supplied ? 0 : 1)
    expect(stats.endpointCacheHits).toBeGreaterThan(0)
  }
})
