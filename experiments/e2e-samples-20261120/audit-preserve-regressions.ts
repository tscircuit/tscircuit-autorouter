import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { AnyCircuitElement, PcbPort, SourcePort } from "circuit-json"
import * as checks from "@tscircuit/checks"
import { findFloatingCopper } from "lib/utils/copper-pour-connectivity/find-floating-copper"
import { arePortsConnected } from "./connectivity"

type SourcePortId = SourcePort["source_port_id"]
type SubcircuitConnectivityMapKey = NonNullable<
  SourcePort["subcircuit_connectivity_map_key"]
>

function assessCircuit(circuitJson: AnyCircuitElement[]) {
  const sourcePorts = circuitJson.filter((element) => element.type === "source_port")
  const sourceTraces = circuitJson.filter((element) => element.type === "source_trace")
  const sourceNets = circuitJson.filter((element) => element.type === "source_net")
  const traces = circuitJson.filter((element) => element.type === "pcb_trace")
  const vias = circuitJson.filter((element) => element.type === "pcb_via")
  const ports = new Map<PcbPort["source_port_id"], PcbPort>(
    circuitJson
      .filter((element) => element.type === "pcb_port")
      .map((port) => [port.source_port_id, port]),
  )
  const sourcePortIdsByConnectivityKey = new Map<
    SubcircuitConnectivityMapKey,
    Set<SourcePortId>
  >()
  for (const sourcePort of sourcePorts) {
    const connectivityKey = sourcePort.subcircuit_connectivity_map_key
    if (connectivityKey === undefined || !ports.has(sourcePort.source_port_id)) continue
    const sourcePortIds = sourcePortIdsByConnectivityKey.get(connectivityKey) ?? new Set<SourcePortId>()
    sourcePortIds.add(sourcePort.source_port_id)
    sourcePortIdsByConnectivityKey.set(connectivityKey, sourcePortIds)
  }
  const copperConnectedPortGroups = circuitJson.some(
    (element) => element.type === "pcb_copper_pour",
  )
    ? findFloatingCopper(circuitJson).copperConnectedPointGroups
    : []
  let requestedMultiportNets = 0
  let physicallyConnected = 0
  for (const [connectivityKey, sourcePortIds] of sourcePortIdsByConnectivityKey) {
    if (sourcePortIds.size < 2) continue
    requestedMultiportNets++
    const sourceTraceIds = new Set(
      sourceTraces
        .filter((trace) => trace.subcircuit_connectivity_map_key === connectivityKey)
        .map((trace) => trace.source_trace_id),
    )
    const sourceNetIds = new Set(
      sourceNets
        .filter((net) => net.subcircuit_connectivity_map_key === connectivityKey)
        .map((net) => net.source_net_id),
    )
    const netTraces = traces.filter(
      (trace) =>
        sourceTraceIds.has(trace.source_trace_id!) ||
        sourceNetIds.has(trace.source_trace_id!) ||
        trace.subcircuit_connectivity_map_key === connectivityKey,
    )
    if (
      arePortsConnected({
        sourcePortIds: [...sourcePortIds],
        routes: netTraces,
        ports,
        vias,
        copperConnectedPortGroups,
      })
    ) physicallyConnected++
  }

  const clearance = { minClearance: 0.1 }
  const findings = {
    overlap: checks.checkEachPcbTraceNonOverlapping(circuitJson, clearance),
    padTrace: checks.checkPadTraceClearance(circuitJson, clearance),
    viaTrace: checks.checkViaTraceClearance(circuitJson, clearance),
    viaPad: checks.checkViaPadClearance(circuitJson, clearance),
    viaSpacing: checks.checkDifferentNetViaSpacing(circuitJson, clearance),
    continuity: checks.checkTracesAreContiguous(circuitJson),
    viaInPad: checks.checkViasInPads(circuitJson),
    holeTrace: checks.checkHoleTraceClearance(circuitJson, clearance),
    width: checks.checkSourceTracesMatchPcbTraceThickness(circuitJson),
  }
  let wireLengthMm = 0
  for (const trace of traces) {
    for (let pointIndex = 1; pointIndex < trace.route.length; pointIndex++) {
      const previous = trace.route[pointIndex - 1]!
      const next = trace.route[pointIndex]!
      if (previous.route_type !== "wire" || next.route_type !== "wire" || previous.layer !== next.layer) continue
      wireLengthMm += Math.hypot(next.x - previous.x, next.y - previous.y)
    }
  }
  return {
    components: circuitJson.filter((element) => element.type === "pcb_component").length,
    pads: circuitJson.filter((element) => element.type === "pcb_smtpad" || element.type === "pcb_plated_hole").length,
    requestedMultiportNets,
    physicallyConnected,
    traces: traces.length,
    vias: vias.length,
    wireLengthMm,
    drcPolicy: "Standard audit: 0.1mm clearance; not a certificate against stricter board rules. Continuity, via-in-pad and source-width checks retain their API semantics.",
    drc: Object.fromEntries(
      Object.entries(findings).map(([checkName, issues]) => [checkName, issues.length]),
    ),
  }
}

const captureFolder = process.argv[2]
if (!captureFolder) throw new Error("Usage: bun audit-preserve-regressions.ts <capture-folder>")
const assessments = readdirSync(captureFolder)
  .filter((filename) => /^circuit-.*\.json\.gz$/.test(filename))
  .sort()
  .map((filename) => {
    const circuitJson = JSON.parse(
      new TextDecoder().decode(Bun.gunzipSync(readFileSync(join(captureFolder, filename)))),
    ) as AnyCircuitElement[]
    return { capture: filename, ...assessCircuit(circuitJson) }
  })
if (assessments.length === 0) throw new Error(`No circuit captures found in ${captureFolder}`)
writeFileSync(join(captureFolder, "assessment.json"), JSON.stringify(assessments, null, 2), { flag: "wx" })
console.log(JSON.stringify(assessments))
