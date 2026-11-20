import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { AnyCircuitElement, PcbPort } from "circuit-json"
import * as checks from "@tscircuit/checks"
import { findFloatingCopper } from "../lib/utils/copper-pour-connectivity/find-floating-copper"
import { arePortsConnected } from "../../experiments/full-board-priority-analysis/connectivity"

type ExpectedCircuit = {
  nets: { name: string; nativeName: string; members: string[]; width: number; group: string }[]
  clearance: number
  parts: { name: string; pads: { nativePin: string; pin: string | null; kind: string; x: number; y: number }[] }[]
}

const [sample, output] = process.argv.slice(2)
const expected: ExpectedCircuit = JSON.parse(readFileSync(join(import.meta.dir, "expected-circuits.json"), "utf8"))[sample]
const json: AnyCircuitElement[] = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(readFileSync(join(output, "circuit.json.gz")))))
const sourceComponents = json.filter((element) => element.type === "source_component")
const sourcePorts = json.filter((element) => element.type === "source_port")
const sourceNets = json.filter((element) => element.type === "source_net")
const sourceTraces = json.filter((element) => element.type === "source_trace")
const traces = json.filter((element) => element.type === "pcb_trace")
const vias = json.filter((element) => element.type === "pcb_via")
const ports = new Map<PcbPort["source_port_id"], PcbPort>(json.filter((element) => element.type === "pcb_port").map((port) => [port.source_port_id, port]))
const pouredConnections = findFloatingCopper(json).copperConnectedPointGroups
const connected: string[] = []
const disconnected: string[] = []
const membershipErrors: string[] = []
const groups: Record<string, { requested: number; connected: number }> = {}

for (const requested of expected.nets) {
  const emitted = sourceNets.find((net) => net.name === requested.name)
  const terminals = requested.members.map((selector) => {
    const match = /^\.(\S+) > \.(\S+)$/.exec(selector)
    if (!match) throw new Error(`Unsupported port selector: ${selector}`)
    const component = sourceComponents.find((candidate) => candidate.name === match[1])
    return sourcePorts.find((port) => port.source_component_id === component?.source_component_id && (port.name === match[2] || port.port_hints?.includes(match[2])))
  })
  const terminalIds = terminals.flatMap((port) => port ? [port.source_port_id] : [])
  const key = emitted?.subcircuit_connectivity_map_key
  if (!emitted || terminals.some((port) => !port || port.subcircuit_connectivity_map_key !== key)) membershipErrors.push(requested.nativeName)
  const routeIds = new Set(sourceTraces.filter((trace) => trace.subcircuit_connectivity_map_key === key).map((trace) => trace.source_trace_id))
  const netTraces = traces.filter((trace) => trace.source_trace_id === emitted?.source_net_id || routeIds.has(trace.source_trace_id!) || (key !== undefined && trace.subcircuit_connectivity_map_key === key))
  const complete = terminalIds.length === requested.members.length && arePortsConnected(terminalIds, netTraces, ports, vias, pouredConnections)
  if (complete) connected.push(requested.nativeName)
  else disconnected.push(requested.nativeName)
  groups[requested.group] ??= { requested: 0, connected: 0 }
  groups[requested.group].requested++
  if (complete) groups[requested.group].connected++
}

const clearance = { minClearance: expected.clearance }
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
let wireLengthMm = 0
for (const trace of traces) {
  for (let index = 1; index < trace.route.length; index++) {
    const previous = trace.route[index - 1]
    const next = trace.route[index]
    if (previous.route_type === "wire" && next.route_type === "wire" && previous.layer === next.layer) wireLengthMm += Math.hypot(next.x - previous.x, next.y - previous.y)
  }
}
const assessment = {
  sample, requestedNets: expected.nets.length, connectedNets: connected.length,
  connected, disconnected, groups, membershipErrors,
  components: sourceComponents.length, expectedComponents: expected.parts.length,
  pads: json.filter((element) => element.type === "pcb_smtpad" || element.type === "pcb_plated_hole" || element.type === "pcb_hole").length,
  expectedPads: expected.parts.reduce((sum, part) => sum + part.pads.length, 0),
  traces: traces.length, vias: vias.length, wireLengthMm,
  copperPours: json.filter((element) => element.type === "pcb_copper_pour").length,
  drc: Object.fromEntries(Object.entries(findings).map(([name, errors]) => [name, errors.filter((error) => error.type.endsWith("_error")).length])),
  connectivityPolicy: "Continuity through emitted traces, physical via spans and actual same-net pour polygons; singleton nets and diagnostic partials do not count as completed requests.",
}
writeFileSync(join(output, "assessment.json"), JSON.stringify(assessment, null, 2))
writeFileSync(join(output, "findings.json.gz"), Bun.gzipSync(JSON.stringify(findings)))
console.log("E2E_ASSESSMENT", JSON.stringify(assessment))
