import { createPreparedRepairCircuitJsonConverter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPreparedRepairCircuitJsonConverter"
import { expect, test } from "bun:test"
import {
  convertToCircuitJson,
} from "lib/testing/utils/convertToCircuitJson"
import { createPreparedRepairCircuitInput, createPreparedRepairCircuitStats } from "../fixtures/prepared-repair-circuit-input"

test("prepared repair Circuit JSON retains full source ownership, pads, vias, jumpers and element order across mutable candidates", (): void => {
  for (let seed = 0; seed < 12; seed++) {
    const { srj, originalSrj, traces, hdRoutes } = createPreparedRepairCircuitInput(seed)
    const contextBefore = structuredClone({ srj, originalSrj })
    for (const includeOriginalConnections of [false, true]) {
      const stats = createPreparedRepairCircuitStats()
      const options = {
        originalSrj,
        includeOriginalConnections,
        ...(seed % 3 ? {} : { minViaDiameter: 0.7, minViaHoleDiameter: 0.31 }),
      }
      const prepared = createPreparedRepairCircuitJsonConverter(srj, options, stats)
      for (let round = 0; round < 12; round++) {
        const candidate = structuredClone(traces)
        const moved = candidate[round % candidate.length]!
        const first = moved.route[0]!
        if ("x" in first) first.x += round % 2 ? 0.00000000001 : round / 10
        moved.connectsTo = round % 2 ? ["root_1", "original_port"] : ["point_0_0"]
        const before = structuredClone(candidate)
        expect(prepared(candidate)).toEqual(convertToCircuitJson(srj, candidate, options))
        expect(candidate).toEqual(before)
        const highDensity = structuredClone(hdRoutes)
        highDensity[0]!.route[0]!.x += round / 10
        expect(prepared(highDensity)).toEqual(convertToCircuitJson(srj, highDensity, options))
      }
      expect(stats.contextBuilds).toBe(1)
      expect(stats.sourceResolverBuilds).toBe(1)
      expect(stats.routeResolverBuilds).toBe(1)
      expect(stats.conversions).toBe(24)
      expect(stats.endpointQueries).toBe(stats.endpointCacheHits + stats.endpointCacheMisses)
      expect(stats.endpointCacheHits).toBeGreaterThan(0)
      expect(Object.keys(stats)).toHaveLength(16)
    }
    expect({ srj, originalSrj }).toEqual(contextBefore)
  }
})
