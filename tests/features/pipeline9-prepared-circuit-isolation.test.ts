import { expect, test } from "bun:test"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { createPreparedRepairCircuitJsonConverter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPreparedRepairCircuitJsonConverter"
import { createPreparedRepairCircuitInput, createPreparedRepairCircuitStats } from "../fixtures/prepared-repair-circuit-input"

test("prepared conversion returns fresh candidate and static elements without leaking consumer mutations", (): void => {
  const { srj, originalSrj, traces } = createPreparedRepairCircuitInput(2)
  const options = { originalSrj, includeOriginalConnections: true }
  const prepared = createPreparedRepairCircuitJsonConverter(srj, options, createPreparedRepairCircuitStats())
  const expected = convertToCircuitJson(srj, traces, options)
  const retained = prepared(traces)
  const snapshot = structuredClone(retained)
  const damaged = prepared(traces)
  for (const element of damaged) {
    if (element.type === "source_trace") {
      element.source_trace_id = "changed_source"
      element.connected_source_port_ids.push("changed_port")
      element.connected_source_net_ids?.push("changed_net")
    }
    if (element.type === "pcb_port" || element.type === "pcb_plated_hole") element.layers.length = 0
    if (element.type === "pcb_smtpad" && "x" in element) element.x = 1234
    if (element.type === "pcb_trace") element.route.length = 0
  }
  damaged.length = 0
  expect(prepared(traces)).toEqual(expected)
  expect(retained).toEqual(snapshot)
  expect(convertToCircuitJson(srj, traces, options)).toEqual(expected)
})
