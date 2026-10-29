import { expect, test } from "bun:test"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { createPreparedRepairCircuitJsonConverter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPreparedRepairCircuitJsonConverter"
import { createPreparedRepairCircuitInput, createPreparedRepairCircuitStats } from "../fixtures/prepared-repair-circuit-input"

test("exact endpoint containment admission is bounded and declined geometry still follows native conversion", (): void => {
  const fixture = createPreparedRepairCircuitInput(0)
  fixture.srj.connections = fixture.srj.connections.slice(0, 1)
  const stats = createPreparedRepairCircuitStats()
  const prepared = createPreparedRepairCircuitJsonConverter(fixture.srj, {}, stats)
  const trace = structuredClone(fixture.traces[0]!)
  for (let index = 0; index < 2060; index++) {
    trace.route = [
      { route_type: "wire", x: index / 10, y: 1, layer: "top", width: 0.1 },
      { route_type: "wire", x: index / 10, y: 2, layer: "top", width: 0.1 },
    ]
    const converted = prepared([trace])
    if (index === 0 || index >= 2045) {
      expect(converted).toEqual(convertToCircuitJson(fixture.srj, [trace]))
    }
  }
  expect(stats.endpointCacheEntries).toBe(4096)
  expect(stats.endpointCacheDeclines).toBe(24)
  expect(stats.endpointObstacleTests).toBe(4120 * fixture.srj.obstacles.length)
  expect(stats.endpointQueries).toBe(4120)
  expect(stats.endpointCacheHits).toBe(0)
})
