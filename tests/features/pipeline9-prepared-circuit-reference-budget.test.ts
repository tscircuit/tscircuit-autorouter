import { expect, test } from "bun:test"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { createPreparedRepairCircuitJsonConverter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPreparedRepairCircuitJsonConverter"
import { createPreparedRepairCircuitInput, createPreparedRepairCircuitStats } from "../fixtures/prepared-repair-circuit-input"

test("prepared endpoint containment bounds retained obstacle references independently of point entries", (): void => {
  const { srj, traces } = createPreparedRepairCircuitInput(0)
  srj.connections = srj.connections.slice(0, 1)
  srj.obstacles = Array.from({ length: 32769 }, () => ({
    type: "rect" as const,
    center: { x: 0, y: 0 },
    width: 20,
    height: 20,
    layers: ["top"],
    connectedTo: [],
  }))
  const candidate = [structuredClone(traces[0]!)]
  const stats = createPreparedRepairCircuitStats()
  const prepared = createPreparedRepairCircuitJsonConverter(srj, {}, stats)
  const expected = convertToCircuitJson(srj, candidate)
  expect(prepared(candidate)).toEqual(expected)
  expect(stats.endpointCacheEntries).toBe(1)
  expect(stats.endpointCacheDeclines).toBe(1)
  expect(prepared(candidate)).toEqual(expected)
  expect(stats.endpointCacheHits).toBe(1)
  expect(stats.endpointCacheEntries).toBe(1)
  expect(stats.endpointCacheDeclines).toBe(2)
})
