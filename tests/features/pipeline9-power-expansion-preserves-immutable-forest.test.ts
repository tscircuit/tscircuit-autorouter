import { expect, test } from "bun:test"
import { preparePipeline7PowerTraceExpansionInput } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/prepare-pipeline7-power-trace-expansion-input"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("power expansion keeps exact immutable branch IDs fixed while expanding user preloads on the same net", (): void => {
  const forest: SimplifiedPcbTrace = {
    type: "pcb_trace", pcb_trace_id: "actual-certified-branch", connection_name: "power-forest-alias",
    route: [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 1, y: 0, layer: "top", width: 0.1 },
    ],
  }
  const user: SimplifiedPcbTrace = { ...forest, pcb_trace_id: "pipeline9_forest_user-preload", connection_name: "POWER" }
  const originalSrj: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, obstacles: [],
    connections: [{ name: "POWER", pointsToConnect: [
      { x: 0, y: 0, layer: "top", pcb_port_id: "supply" },
    ] }, { name: "power-forest-alias", rootConnectionName: "POWER", pointsToConnect: [
      { x: 0, y: 0, layer: "top", pcb_port_id: "supply" },
    ] }], traces: [forest, user],
  }
  for (const resolveConnectedTraceAliases of [false, true]) {
    const input = preparePipeline7PowerTraceExpansionInput({ originalSrj, newlyRoutedTraces: [],
      expandedConnectionNames: ["POWER", "power-forest-alias"], immutableTraceIds: [forest.pcb_trace_id],
      resolveConnectedTraceAliases })
    expect(input.fixedTraces).toEqual([forest])
    expect(input.fixedTraces[0]).toBe(forest)
    expect(input.traces).toEqual([{ ...user, __replaces_pcb_trace_id: user.pcb_trace_id }])
    expect(forest.__replaces_pcb_trace_id).toBeUndefined()
  }
  const legacy = preparePipeline7PowerTraceExpansionInput({ originalSrj, newlyRoutedTraces: [],
    expandedConnectionNames: ["POWER", "power-forest-alias"], resolveConnectedTraceAliases: true })
  expect(legacy.fixedTraces).toEqual([])
  expect(legacy.traces).toHaveLength(2)
})
