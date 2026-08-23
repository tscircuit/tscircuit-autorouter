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

test("power expansion ignores trace ID collisions across unrelated nets", () => {
  const powerTrace = createTrace("trace_power", "POWER")
  const fixedSignalTrace = createTrace("trace_signal", "SIGNAL")
  const newlyRoutedPowerTrace = createTrace("trace_signal", "POWER")
  const originalSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -1, minY: -1, maxX: 2, maxY: 1 },
    obstacles: [],
    connections: [],
    traces: [powerTrace, fixedSignalTrace],
  }

  const input = preparePipeline7PowerTraceExpansionInput({
    originalSrj,
    newlyRoutedTraces: [newlyRoutedPowerTrace],
    expandedConnectionNames: ["POWER"],
    resolveConnectedTraceAliases: true,
  })

  expect(input.fixedTraces).toEqual([fixedSignalTrace])
  expect(input.traces).toEqual([
    newlyRoutedPowerTrace,
    {
      ...powerTrace,
      __replaces_pcb_trace_id: "trace_power",
    },
  ])
})
