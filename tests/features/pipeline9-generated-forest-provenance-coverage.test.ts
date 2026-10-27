import { expect, test } from "bun:test"
import { prepareGeneratedForestBoundedRepairInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/prepareGeneratedForestBoundedRepairInput"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("duplicate materialized branch IDs cannot stand in for a missing generated branch", (): void => {
  const branch: SimplifiedPcbTrace = {
    type: "pcb_trace", pcb_trace_id: "branch-a", connection_name: "forest",
    route: [{ route_type: "wire", x: -1, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 1, y: 0, layer: "top", width: 0.1 }],
  }
  const other = { ...branch, pcb_trace_id: "branch-b" }
  const input: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, obstacles: [], connections: [], traces: [branch, other] }
  const params = { originalSrj: input, generatedFixedTraceIds: new Set([branch.pcb_trace_id, other.pcb_trace_id]),
    connMap: getConnectivityMapFromSimpleRouteJson(input), defaultViaDiameter: 0.3 }
  expect(() => prepareGeneratedForestBoundedRepairInput({ ...params, updatedPreloadedTraces: [branch, structuredClone(branch)] }))
    .toThrow("duplicated an owned copper branch")
  expect(() => prepareGeneratedForestBoundedRepairInput({ ...params, updatedPreloadedTraces: [branch] }))
    .toThrow("lost an owned copper branch")
  expect(prepareGeneratedForestBoundedRepairInput({ ...params, updatedPreloadedTraces: [branch, other] }).projectedTraceCount).toBe(2)
})
