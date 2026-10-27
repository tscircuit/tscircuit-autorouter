import { expect, test } from "bun:test"
import { prepareGeneratedForestBoundedRepairInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/prepareGeneratedForestBoundedRepairInput"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("bounded repair's forest envelope includes full wire caps, maximum width, and physical via spans", () => {
  const trace: SimplifiedPcbTrace = { type: "pcb_trace", pcb_trace_id: "owned", connection_name: "net", route: [
    { route_type: "wire", x: -2, y: 0, width: 0.1, layer: "top" },
    { route_type: "wire", x: 2, y: 0, width: 0.3, layer: "top" },
    { route_type: "via", x: 2, y: 0, via_diameter: 0.8, from_layer: "top", to_layer: "inner1" },
  ] }
  const input: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.1, bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    obstacles: [], connections: [], traces: [trace] }
  for (const allowBlindAndBuriedVias of [false, true]) {
    const srj = { ...input, allowBlindAndBuriedVias }
    const projection = prepareGeneratedForestBoundedRepairInput({ originalSrj: srj, updatedPreloadedTraces: [trace], generatedFixedTraceIds: new Set([trace.pcb_trace_id]),
      connMap: getConnectivityMapFromSimpleRouteJson(srj), defaultViaDiameter: 0.3 })
    expect(projection.projectedTraceCount).toBe(1)
    expect(projection.primitiveCount).toBe(2)
    expect(projection.srj.traces).toBeUndefined()
    const wire = projection.srj.obstacles[0]!
    expect(wire.width).toBe(4.3)
    expect(wire.height).toBe(0.3)
    expect(wire.center.x + wire.width / 2).toBe(2.15)
    const via = projection.srj.obstacles[1]!
    expect(via.width).toBe(0.8)
    expect(via.layers).toEqual(allowBlindAndBuriedVias ? ["top", "inner1"] : ["top", "inner1", "inner2", "bottom"])
  }
  const unsupported = { ...trace, route: [{ route_type: "jumper" as const, start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, footprint: "0603" as const, layer: "top" }] }
  expect(() => prepareGeneratedForestBoundedRepairInput({ originalSrj: { ...input, traces: [unsupported] }, updatedPreloadedTraces: [unsupported], generatedFixedTraceIds: new Set([trace.pcb_trace_id]),
    connMap: getConnectivityMapFromSimpleRouteJson(input), defaultViaDiameter: 0.3 })).toThrow("unsupported fixed copper")
})
