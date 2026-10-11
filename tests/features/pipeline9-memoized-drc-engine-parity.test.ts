import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine, type SimpleRouteJson, type SimplifiedPcbTraces } from "high-density-repair03/lib"
import { Pipeline9MemoizedAutoroutingDrcEngine } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair03/Pipeline9MemoizedAutoroutingDrcEngine"

test("memoized clear checks preserve exact errors and counters after in-place geometry, metadata and connectivity edits", (): void => {
  const connMap = new ConnectivityMap({ first: ["net0", "port0"], second: ["net1", "port1"] })
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    layerCount: 2,
    minTraceWidth: 0.1,
    connections: [],
    obstacles: [
      { type: "rect", center: { x: 0.1, y: 0.6 }, width: 0.3, height: 0.5, ccwRotationDegrees: 35, layers: ["top"], connectedTo: ["pad-net", "pcb_smtpad_cache_fixture"] },
      { type: "rect", center: { x: 1.2, y: 0.2 }, width: 0.3, height: 0.3, layers: ["top", "bottom"], connectedTo: ["net4", "pcb_plated_hole_cache_fixture"] },
    ],
  }
  const options = { connMap, spatialCellSize: 0.25, includeTraceViaOwnerMetadata: true }
  const baseline = new AutoroutingDrcEngine(srj, options)
  const memoized = new Pipeline9MemoizedAutoroutingDrcEngine(srj, options)
  const traces: SimplifiedPcbTraces = []
  for (let index = 0; index < 5; index++) {
    const y = index * 0.3 - 0.6
    traces.push({
      type: "pcb_trace",
      pcb_trace_id: `trace${index}`,
      connection_name: `net${index}`,
      route: Array.from({ length: 11 }, (_, pointIndex) => ({ route_type: "wire" as const, x: -2 + pointIndex * 0.4, y, width: 0.12, layer: "top", start_pcb_port_id: pointIndex === 0 ? `port${index}` : undefined })),
    })
    traces[index]!.route.push({ route_type: "via", x: index * 0.25, y, from_layer: "top", to_layer: "bottom", via_diameter: 0.3 })
  }
  let observedErrors = 0
  let exactChecks = 0
  for (let iteration = 0; iteration < 80; iteration++) {
    const trace = traces[iteration % traces.length]!
    const point = trace.route[1 + iteration % 9]!
    if (point.route_type !== "wire") throw new Error("Parity fixture requires a wire point")
    point.y = (iteration % 5) * 0.3 - 0.6 + ((iteration % 4) - 2) * 0.08
    point.width = iteration % 7 === 0 ? 0.6 : 0.12
    point.layer = iteration % 11 === 0 ? "bottom" : "top"
    if (iteration % 17 === 0) point.x = -0
    const via = trace.route.at(-1)!
    if (via.route_type !== "via") throw new Error("Parity fixture requires a terminal via")
    via.x = (iteration % 5) * 0.25 + (iteration % 4) * 0.015
    via.via_diameter = iteration % 9 === 0 ? 0.5 : 0.3
    trace.pcb_trace_id = `changed${iteration % 3}_${iteration % traces.length}`
    point.start_pcb_port_id = `port${iteration % 8}`
    if (iteration === 40) connMap.addConnections([["net0", "net1", "pad-net"]])
    if (iteration % 13 === 0) traces.reverse()
    const original = structuredClone(traces)
    for (const legacy of [false, true, false]) {
      const expected = legacy ? baseline.evaluateLegacy(traces) : baseline.evaluate(traces)
      const actual = legacy ? memoized.evaluateLegacy(traces) : memoized.evaluate(traces)
      expect(actual).toEqual(expected)
      expect(memoized.lastRunStats).toEqual(baseline.lastRunStats)
      expect(traces).toEqual(original)
      observedErrors += actual.errors.length
      exactChecks += memoized.lastRunStats.exactCheckCount
      // A caller may edit an earlier error without changing future evaluations.
      const firstCenter = actual.errors.find((error) => error.center)?.center
      if (firstCenter) firstCenter.x = 999
    }
  }
  expect(observedErrors).toBeGreaterThan(100)
  expect(exactChecks).toBeGreaterThan(10_000)
})
