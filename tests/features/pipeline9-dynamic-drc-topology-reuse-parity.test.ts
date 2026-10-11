import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine, type SimpleRouteJson, type SimplifiedPcbTraces } from "high-density-repair03/lib"
import { Pipeline9MemoizedAutoroutingDrcEngine } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair03/Pipeline9MemoizedAutoroutingDrcEngine"

test("reused dynamic cell topology rebinds current geometry and rebuilds ordered rows, layers, spans and cell boundaries exactly", (): void => {
  const connMap = new ConnectivityMap({ first: ["net0", "port0"], second: ["net1", "port1"] })
  const srj: SimpleRouteJson = {
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 }, layerCount: 4, minTraceWidth: 0.1,
    allowBlindAndBuriedVias: true, connections: [], obstacles: [],
  }
  const options = { connMap, spatialCellSize: 1, includeTraceViaOwnerMetadata: true }
  const baseline = new AutoroutingDrcEngine(srj, options)
  const reused = new Pipeline9MemoizedAutoroutingDrcEngine(srj, options)
  const inspected = reused as unknown as { dynamicIndexesByLayer?: Map<string, unknown> }
  const traces: SimplifiedPcbTraces = Array.from({ length: 4 }, (_, index) => ({
    type: "pcb_trace" as const, pcb_trace_id: `trace${index}`, connection_name: `net${index}`,
    route: [
      { route_type: "wire" as const, x: -0.5, y: 0.2 + index * 0.15, width: 0.12, layer: "top", start_pcb_port_id: `port${index}` },
      { route_type: "wire" as const, x: 0.5, y: 0.2 + index * 0.15, width: 0.12, layer: "top", end_pcb_port_id: `port${index}` },
      { route_type: "via" as const, x: 0.5, y: 0.2 + index * 0.15, from_layer: "top", to_layer: "inner1", via_diameter: 0.3 },
    ],
  }))
  let previousIndexes: Map<string, unknown> | undefined
  let retainedResult: ReturnType<typeof reused.evaluate> | undefined
  let retainedSnapshot: ReturnType<typeof reused.evaluate> | undefined
  let reuseCount = 0
  let rebuildCount = 0
  for (let iteration = 0; iteration < 20; iteration++) {
    const wire = traces[0]!.route[1]!
    const via = traces[0]!.route.at(-1)!
    if (wire.route_type !== "wire" || via.route_type !== "via") throw new Error("Dynamic cache fixture lost its original copper")
    wire.y = iteration % 2 ? 0.21 : 0.22
    wire.width = iteration % 3 ? 0.12 : 0.13
    wire.end_pcb_port_id = `current-port-${iteration}`
    traces[0]!.pcb_trace_id = `current-trace-${iteration}`
    if (iteration === 3) via.to_layer = "bottom"
    if (iteration === 5) wire.layer = "bottom"
    if (iteration === 7) traces.reverse()
    if (iteration === 9) wire.x = 1.5
    if (iteration === 11) traces[1]!.route.splice(1, 0, { route_type: "wire", x: 0, y: 0.6, width: 0.12, layer: "top" })
    if (iteration === 13) connMap.addConnections([["net0", "net1"]])
    if (iteration === 15) via.x = -0
    if (iteration === 17) via.x = 0
    const original = structuredClone(traces)
    for (const legacy of [false, true, false]) {
      const expected = legacy ? baseline.evaluateLegacy(traces) : baseline.evaluate(traces)
      const actual = legacy ? reused.evaluateLegacy(traces) : reused.evaluate(traces)
      expect(actual).toEqual(expected)
      expect(reused.lastRunStats).toEqual(baseline.lastRunStats)
      expect(traces).toEqual(original)
      if (previousIndexes) {
        if (inspected.dynamicIndexesByLayer === previousIndexes) reuseCount++
        else rebuildCount++
      }
      previousIndexes = inspected.dynamicIndexesByLayer
      if (retainedResult) expect(retainedResult).toEqual(retainedSnapshot!)
      const changedError = actual.errors.find((error) => error.center)
      if (changedError?.center) changedError.center.x = 999
      retainedResult = actual
      retainedSnapshot = structuredClone(actual)
    }
  }
  expect(reuseCount).toBeGreaterThan(20)
  expect(rebuildCount).toBeGreaterThan(4)
})
