import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine, type SimpleRouteJson, type SimplifiedPcbTraces } from "high-density-repair03/lib"
import { Pipeline9MemoizedAutoroutingDrcEngine } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair03/Pipeline9MemoizedAutoroutingDrcEngine"

test("cached static cell queries preserve live connectivity, fresh errors and native traversal after eviction", (): void => {
  const connMap = new ConnectivityMap({ first: ["net0", "port0"], second: ["pad-net", "pad-port"] })
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, layerCount: 2, minTraceWidth: 0.1,
    obstacles: [
      { type: "rect", center: { x: 0.2, y: 0.2 }, width: 0.5, height: 0.6, ccwRotationDegrees: 35, layers: ["top"], connectedTo: ["pad-net", "pcb_smtpad_static_cache", "pad-port"] },
      { type: "rect", center: { x: 0.4, y: 0 }, width: 0.5, height: 0.5, layers: ["top", "bottom"], connectedTo: ["pad-net", "pcb_plated_hole_static_cache"] },
    ], connections: [],
  }
  const options = { connMap, spatialCellSize: 0.25, includeTraceViaOwnerMetadata: true }
  const baseline = new AutoroutingDrcEngine(srj, options)
  const cached = new Pipeline9MemoizedAutoroutingDrcEngine(srj, options)
  const traces: SimplifiedPcbTraces = [{
    type: "pcb_trace", pcb_trace_id: "trace0", connection_name: "net0",
    route: [
      { route_type: "wire", x: -0.4, y: 0.2, width: 0.12, layer: "top", start_pcb_port_id: "port0" },
      { route_type: "wire", x: 0.5, y: 0.2, width: 0.12, layer: "top", end_pcb_port_id: "port0" },
      { route_type: "via", x: 0.45, y: 0.2, from_layer: "top", to_layer: "bottom", via_diameter: 0.3 },
    ],
  }]
  const inspected = cached as unknown as { obstacleIndexesByLayer: Map<string, { queryCache: Map<string, unknown[]> }> }
  let observedErrors = 0
  for (let iteration = 0; iteration < 12; iteration++) {
    if (iteration === 8) connMap.addConnections([["net0", "pad-net"]])
    const wire = traces[0]!.route[1]!
    if (wire.route_type !== "wire") throw new Error("Static cache fixture lost its wire endpoint")
    wire.y += iteration % 2 ? -0.001 : 0.001
    for (const legacy of [false, true]) {
      const expected = legacy ? baseline.evaluateLegacy(traces) : baseline.evaluate(traces)
      const actual = legacy ? cached.evaluateLegacy(traces) : cached.evaluate(traces)
      expect(actual).toEqual(expected)
      expect(cached.lastRunStats).toEqual(baseline.lastRunStats)
      observedErrors += actual.errors.length
      const first = actual.errorsWithCenters.find((error) => error.center)
      if (first?.center) first.center.x = 999
      const portIds = actual.errorsWithCenters.find((error) => Array.isArray(error.pcb_port_ids))?.pcb_port_ids
      if (Array.isArray(portIds)) portIds.push("mutated-old-error")
    }
  }
  expect(observedErrors).toBeGreaterThan(0)
  expect(cached.evaluate(traces).errors).toHaveLength(0)
  const topIndex = inspected.obstacleIndexesByLayer.get("top")!
  const warmedEntries = topIndex.queryCache.size
  expect(warmedEntries).toBeGreaterThan(0)
  cached.evaluate(traces)
  expect(topIndex.queryCache.size).toBe(warmedEntries)
  for (let index = 0; index < 4100; index++) {
    const x = 10 + index * 0.5
    traces[0]!.route = [
      { route_type: "wire", x, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: x + 0.01, y: 0, width: 0.1, layer: "top" },
    ]
    expect(cached.evaluate(traces)).toEqual(baseline.evaluate(traces))
    expect(cached.lastRunStats).toEqual(baseline.lastRunStats)
  }
  expect(topIndex.queryCache.size).toBe(4096)
})
