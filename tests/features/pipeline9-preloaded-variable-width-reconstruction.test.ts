import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { applyFixedRouteReplacementsToPreloadedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyFixedRouteReplacementsToPreloadedTraces"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import type { SimplifiedPcbTrace } from "lib/types"

test("moving a power-trace section preserves the widths of its pad escapes", (): void => {
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "power",
    connection_name: "power",
    route: [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.2 },
      { route_type: "wire", x: 1, y: 0, layer: "top", width: 0.8 },
      { route_type: "wire", x: 3, y: 0, layer: "top", width: 0.2 },
      { route_type: "wire", x: 4, y: 0, layer: "top", width: 0.2 },
    ],
  }
  const before = structuredClone(trace)
  const connMap = new ConnectivityMap({})
  const original = convertPreloadedTraceToHdRoutes(trace, 0, 2, 0.45, connMap)
  expect(original.map((route) => route.traceThickness)).toEqual([0.2, 0.8, 0.2])
  const updated = structuredClone(original)
  updated[1]!.route.splice(1, 0, { x: 2, y: 0.5, z: 0 })
  const result = applyFixedRouteReplacementsToPreloadedTraces({
    originalTraces: [trace],
    originalFixedRoutes: original,
    updatedFixedRoutes: updated,
    replacedConnectionNames: new Set([updated[1]!.connectionName]),
    layerCount: 2,
    defaultViaHoleDiameter: 0.2,
    obstacles: [],
    connMap,
  })
  const route = result.updatedPreloadedTraces[0]!.route
  expect(route).toEqual([
    before.route[0]!,
    before.route[1]!,
    { route_type: "wire", x: 2, y: 0.5, layer: "top", width: 0.8 },
    before.route[2]!,
    before.route[3]!,
  ])
  expect(trace).toEqual(before)
  expect(updated[0]).toEqual(original[0])
  expect(updated[2]).toEqual(original[2])
})
