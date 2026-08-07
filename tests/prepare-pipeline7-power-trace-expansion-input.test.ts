import { expect, test } from "bun:test"
import { preparePipeline7PowerTraceExpansionInput } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/prepare-pipeline7-power-trace-expansion-input"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

const createTrace = (
  pcbTraceId: string,
  connectionName: string,
): SimplifiedPcbTrace => ({
  type: "pcb_trace",
  pcb_trace_id: pcbTraceId,
  connection_name: connectionName,
  route: [
    { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.15 },
    { route_type: "wire", x: 1, y: 0, layer: "top", width: 0.15 },
  ],
})

test("Pipeline7 makes selected preloaded power traces mutable replacements", () => {
  const powerTrace = createTrace("trace_power", "POWER")
  const signalTrace = createTrace("trace_signal", "SIGNAL")
  const newlyRoutedTrace = createTrace("trace_power", "NEW")
  const originalSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -1, minY: -1, maxX: 2, maxY: 1 },
    obstacles: [],
    connections: [],
    traces: [powerTrace, signalTrace],
  }

  const input = preparePipeline7PowerTraceExpansionInput({
    originalSrj,
    newlyRoutedTraces: [newlyRoutedTrace],
    expandedConnectionNames: ["POWER"],
  })

  expect(input.traces).toEqual([
    newlyRoutedTrace,
    {
      ...powerTrace,
      pcb_trace_id: "trace_power_power_expansion_2",
      __replaces_pcb_trace_id: "trace_power",
    },
  ])
  expect(input.fixedTraces).toEqual([signalTrace])
  expect(powerTrace.__replaces_pcb_trace_id).toBeUndefined()
})
