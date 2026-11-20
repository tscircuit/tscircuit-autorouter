import { readFileSync, writeFileSync } from "node:fs"
import * as checks from "@tscircuit/checks"
import type { AnyCircuitElement, PcbPort } from "circuit-json"
import { arePortsConnected } from "./connectivity"

const json: AnyCircuitElement[] = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(readFileSync("native.circuit.json.gz"))))
const ports = new Map<PcbPort["source_port_id"], PcbPort>(json.filter((element) => element.type === "pcb_port").map((port) => [port.source_port_id, port]))
const traces = json.filter((element) => element.type === "pcb_trace")
const vias = json.filter((element) => element.type === "pcb_via")
const requested = json.filter((element) => element.type === "source_trace" && ["DATA0", "DATA1", "DATA2", "SCLK", "MOSI", "MISO", "RESET_N", "IRQ"].includes(element.name ?? ""))
const nets = requested.map((trace) => ({
  name: trace.name,
  connected: arePortsConnected({
    sourcePortIds: trace.connected_source_port_ids,
    routes: traces.filter((route) => route.subcircuit_connectivity_map_key === trace.subcircuit_connectivity_map_key),
    ports,
    vias,
  }),
}))
const clearance = { minClearance: 0.1 }
const findings = {
  overlap: checks.checkEachPcbTraceNonOverlapping(json, clearance),
  padTrace: checks.checkPadTraceClearance(json, clearance),
  viaTrace: checks.checkViaTraceClearance(json, clearance),
  viaPad: checks.checkViaPadClearance(json, clearance),
  viaSpacing: checks.checkDifferentNetViaSpacing(json),
  continuity: checks.checkTracesAreContiguous(json),
  viaInPad: checks.checkViasInPads(json),
  holeTrace: checks.checkHoleTraceClearance(json, clearance),
  width: checks.checkSourceTracesMatchPcbTraceThickness(json),
}
const result = {
  requestedNets: requested.length,
  connectedNets: nets.filter((net) => net.connected).length,
  nets,
  traces: traces.length,
  vias: vias.length,
  errors: json.filter((element) => element.type === "pcb_autorouting_error"),
  phases: JSON.parse(readFileSync("native-phases.json", "utf8")),
  drc: Object.fromEntries(Object.entries(findings).map(([name, errors]) => [name, errors.filter((error) => error.type.endsWith("_error")).length])),
}
writeFileSync("native-assessment.json", JSON.stringify(result, null, 2))
console.log("NATIVE_ASSESSMENT", JSON.stringify(result))
