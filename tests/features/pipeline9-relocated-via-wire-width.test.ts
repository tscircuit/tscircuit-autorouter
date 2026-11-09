import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { applyFixedRouteReplacementsToPreloadedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyFixedRouteReplacementsToPreloadedTraces"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import type { SimplifiedPcbTrace } from "lib/types"
import fixture from "../fixtures/rvboy-dram-zq-preloaded.json"

test("relocating the RVboy DRAM_ZQ via retains manufacturable wire widths", (): void => {
  const trace = structuredClone(fixture) as SimplifiedPcbTrace
  const before = structuredClone(trace)
  const connMap = new ConnectivityMap({})
  const original = convertPreloadedTraceToHdRoutes(trace, 0, 4, 0.45, connMap)
  const updated = structuredClone(original)
  const viaSection = updated.find(
    (section) => section.preloadedRoutePositionStart === 6,
  )!
  // Exact first-via relocation from the completed native final phase. Board
  // coordinates are mm, +X right and +Y up; z indexes top through bottom.
  viaSection.route = [
    { x: 2.165, y: 6.678, z: 0 },
    { x: 2.165, y: 6.71, z: 0 },
    { x: 2.15, y: 6.725, z: 0 },
    { x: 2.15, y: 6.725, z: 3 },
    { x: 2.15, y: 6.693, z: 3 },
    { x: 2.165, y: 6.678, z: 3 },
  ]
  viaSection.vias = [{ x: 2.15, y: 6.725 }]
  const rebuilt = applyFixedRouteReplacementsToPreloadedTraces({
    originalTraces: [trace],
    originalFixedRoutes: original,
    updatedFixedRoutes: updated,
    replacedConnectionNames: new Set([viaSection.connectionName]),
    layerCount: 4,
    defaultViaHoleDiameter: 0.2,
    obstacles: [],
    connMap,
  }).updatedPreloadedTraces[0]!
  const wireWidths = rebuilt.route.flatMap((point) =>
    point.route_type === "wire" ? [point.width] : [],
  )
  expect(Math.min(...wireWidths)).toBe(0.1)
  expect(
    rebuilt.route.some(
      (point) =>
        point.route_type === "via" && point.x === 2.15 && point.y === 6.725,
    ),
  ).toBe(true)
  expect(rebuilt.route[0]).toEqual(trace.route[0])
  expect(rebuilt.route.at(-1)).toEqual(trace.route.at(-1))
  expect(trace).toEqual(before)
})
