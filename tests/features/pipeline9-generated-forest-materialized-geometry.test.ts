import { expect, test } from "bun:test"
import { prepareGeneratedForestBoundedRepairInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/prepareGeneratedForestBoundedRepairInput"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("fixed forest projection follows current materialized copper rather than its initial branch positions", () => {
  const initial: SimplifiedPcbTrace = { type: "pcb_trace", pcb_trace_id: "explicit-owned-id", connection_name: "net", route: [
    { route_type: "wire", x: -2, y: 0, width: 0.2, layer: "top" },
    { route_type: "wire", x: 2, y: 0, width: 0.2, layer: "top" },
  ] }
  const current: SimplifiedPcbTrace = { ...initial, route: [initial.route[0]!,
    { route_type: "wire", x: 0, y: 1, width: 0.4, layer: "top" }, initial.route[1]!] }
  const input: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.2,
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 }, obstacles: [], connections: [], traces: [initial] }
  const before = structuredClone(input)
  const projection = prepareGeneratedForestBoundedRepairInput({ originalSrj: input, updatedPreloadedTraces: [current],
    generatedFixedTraceIds: new Set([initial.pcb_trace_id]), connMap: getConnectivityMapFromSimpleRouteJson(input), defaultViaDiameter: 0.3 })
  expect(projection.projectedTraceCount).toBe(1)
  expect(projection.primitiveCount).toBe(2)
  expect(projection.srj.obstacles.map((obstacle) => obstacle.center)).toEqual([{ x: -1, y: 0.5 }, { x: 1, y: 0.5 }])
  expect(projection.srj.obstacles.every((obstacle) => obstacle.height === 0.4)).toBe(true)
  expect(input).toEqual(before)
  expect(() => prepareGeneratedForestBoundedRepairInput({ originalSrj: input, updatedPreloadedTraces: [],
    generatedFixedTraceIds: new Set([initial.pcb_trace_id]), connMap: getConnectivityMapFromSimpleRouteJson(input), defaultViaDiameter: 0.3 })).toThrow("lost an owned copper branch")
})
