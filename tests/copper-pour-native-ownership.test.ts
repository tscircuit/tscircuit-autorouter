import { expect, test } from "bun:test"
import { createCopperPourTraceEvaluator } from "lib/testing/createCopperPourTraceEvaluator"
import type { SimplifiedPcbTrace } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { copperPourReservationInput, copperPourSignalTrace } from "./fixtures/copper-pour-reservations"

test("copper-pour ownership comes from native connection names, not output metadata or planning maps", (): void => {
  const input = copperPourReservationInput()
  input.connections.find(connection => connection.name === "GROUND")!.source_trace_id = "source_trace_ground"
  const signal = copperPourSignalTrace("inner1")
  const nativeGround: SimplifiedPcbTrace = {
    ...signal, pcb_trace_id: "native_ground", connection_name: "preloaded_ground",
    connectsTo: ["pcb_port_ground", "GROUND"],
  }
  input.traces = [nativeGround]
  const original = JSON.stringify(input)
  const planningConnectivity = getConnectivityMapFromSimpleRouteJson(input)
  const nativeChecker = createCopperPourTraceEvaluator(input, 0.1, planningConnectivity)
  planningConnectivity.addConnections([["DATA", "GROUND"]])
  const mergedChecker = createCopperPourTraceEvaluator(input, 0.1, planningConnectivity)
  const forgedSignals: SimplifiedPcbTrace[] = [
    signal,
    { ...signal, connectsTo: ["GROUND"] },
    { ...signal, pcb_trace_id: "GROUND" },
    { ...signal, pcb_trace_id: "native_ground", connectsTo: ["GROUND", "pcb_port_ground"] },
    { ...signal, connection_name: "undeclared_signal", pcb_trace_id: "GROUND", connectsTo: ["GROUND"] },
  ]
  for (const checker of [nativeChecker, mergedChecker]) {
    for (const forged of forgedSignals) {
      expect(checker([forged])).toHaveLength(1)
    }
    for (const connectionName of ["GROUND", "ground_alias", "source_trace_ground", "preloaded_ground"]) {
      expect(checker([{ ...signal, connection_name: connectionName, connectsTo: [], pcb_trace_id: "DATA" }])).toEqual([])
    }
    expect(checker([nativeGround])).toEqual([])
  }
  expect(JSON.stringify(input)).toBe(original)
})
