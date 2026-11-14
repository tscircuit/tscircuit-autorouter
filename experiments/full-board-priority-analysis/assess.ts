import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import * as checks from "@tscircuit/checks"
import { arePortsConnected } from "./connectivity"
import type { FullBoardSource } from "./native-full-board"

const [id, folderArg] = process.argv.slice(2)
const folder = resolve(folderArg)
const source: FullBoardSource = JSON.parse(readFileSync(new URL(`./${id}/source.json`, import.meta.url), "utf8"))
const json: any[] = JSON.parse(readFileSync(join(folder, "circuit.json"), "utf8"))
const components = new Map(json.filter((e) => e.type === "source_component").map((e) => [e.name, e]))
const sourcePorts = json.filter((e) => e.type === "source_port")
const sourceNets = new Map(json.filter((e) => e.type === "source_net").map((e) => [e.name, e]))
const sourceTraces = json.filter((e) => e.type === "source_trace")
const routes = json.filter((e) => e.type === "pcb_trace")
const vias = json.filter((e) => e.type === "pcb_via")
const ports = new Map(json.filter((e) => e.type === "pcb_port").map((e) => [e.source_port_id, e]))
const geometryErrors: string[] = []
const membershipErrors: string[] = []
const missingCopper: { name: string; members: number }[] = []
const pours = json.filter((e) => e.type === "pcb_copper_pour")
let copperConnectedPortGroups: string[][] = []
if (pours.length > 0) {
  if (!process.env.FULL_BOARD_COPPER_MODULE) throw new Error("Actual pour geometry requires the copper connectivity checker")
  const { findFloatingCopper } = await import(process.env.FULL_BOARD_COPPER_MODULE)
  copperConnectedPortGroups = findFloatingCopper(json).copperConnectedPointGroups
}

for (const part of source.parts) {
  const component = components.get(part.name)
  if (!component) { geometryErrors.push(`Missing source component ${part.name}`); continue }
  const pcbComponent = json.find((e) => e.type === "pcb_component" && e.source_component_id === component.source_component_id)
  if (!pcbComponent) { geometryErrors.push(`Missing PCB component ${part.name}`); continue }
  for (const pad of part.pads) {
    const expectedX = part.x + pad.x
    const expectedY = part.y + pad.y
    let found = false
    if (pad.kind === "np_thru_hole") {
      found = json.some((e) => e.type === "pcb_hole" && Math.hypot(e.x-expectedX, e.y-expectedY) < 1e-5)
    } else {
      found = json.some((e) => {
        if (!["pcb_smtpad", "pcb_plated_hole"].includes(e.type) || e.pcb_component_id !== pcbComponent.pcb_component_id) return false
        if (pad.points) return e.shape === "polygon" && e.points.length === pad.points.length && pad.points.every((p, i) => Math.hypot(e.points[i].x-expectedX-p.x, e.points[i].y-expectedY-p.y) < 1e-5)
        return Math.hypot(e.x-expectedX, e.y-expectedY) < 1e-5
      })
    }
    if (!found) geometryErrors.push(`Missing/moved native pad ${part.name}.${pad.nativePin} at ${expectedX},${expectedY}`)
  }
}
if (components.size !== source.parts.length) geometryErrors.push(`Component count: ${components.size}, expected ${source.parts.length}`)
if (sourceNets.size !== source.nets.length) membershipErrors.push(`Net count: ${sourceNets.size}, expected ${source.nets.length}`)
const seenKeys = new Map<string, string>()
for (const net of source.nets) {
  const emitted = sourceNets.get(net.name)
  if (!emitted) { membershipErrors.push(`Missing source net ${net.nativeName}`); continue }
  const key = emitted.subcircuit_connectivity_map_key
  const previous = seenKeys.get(key)
  if (previous) membershipErrors.push(`Shorted source nets ${previous} and ${net.nativeName}`)
  seenKeys.set(key, net.nativeName)
  const expectedPorts = net.members.map((selector) => {
    const match = /^\.(\S+) > \.(\S+)$/.exec(selector)!
    const component = components.get(match[1])
    return sourcePorts.find((p) => p.source_component_id === component?.source_component_id && (p.name === match[2] || p.port_hints?.includes(match[2])))
  })
  const actualPorts = sourcePorts.filter((p) => p.subcircuit_connectivity_map_key === key)
  if (actualPorts.length !== expectedPorts.length || expectedPorts.some((p) => !p || p.subcircuit_connectivity_map_key !== key)) membershipErrors.push(`Source membership mismatch ${net.nativeName}`)
  if (!net.routable) continue
  const ids = new Set(sourceTraces.filter((t) => t.subcircuit_connectivity_map_key === key).map((t) => t.source_trace_id))
  ids.add(emitted.source_net_id)
  const netRoutes = routes.filter((route) => ids.has(route.source_trace_id) || route.subcircuit_connectivity_map_key === key)
  if (expectedPorts.some((p) => !p) || !arePortsConnected(expectedPorts.map((p) => p.source_port_id), netRoutes, ports, vias, copperConnectedPortGroups)) missingCopper.push({ name: net.nativeName, members: net.members.length })
}
const options = { minClearance: source.rules.appliedGlobalClearance }
const findings = {
  routing: json.filter((e) => e.type === "pcb_autorouting_error"),
  overlap: checks.checkEachPcbTraceNonOverlapping(json, options),
  padTrace: checks.checkPadTraceClearance(json, options),
  viaTrace: checks.checkViaTraceClearance(json, options),
  viaPad: checks.checkViaPadClearance(json, options),
  viaSpacing: checks.checkDifferentNetViaSpacing(json),
  contiguous: checks.checkTracesAreContiguous(json),
  viaInPad: checks.checkViasInPads(json),
  holeTrace: checks.checkHoleTraceClearance(json, options),
}
const assessment = {
  id, components: components.size, expectedComponents: source.parts.length,
  pads: json.filter((e) => ["pcb_smtpad", "pcb_plated_hole", "pcb_hole"].includes(e.type)).length,
  expectedPads: source.parts.reduce((n, part) => n+part.pads.length, 0),
  nets: sourceNets.size, expectedNets: source.nets.length,
  routableNets: source.nets.filter((net) => net.routable).length,
  connectedNets: source.nets.filter((net) => net.routable).length-missingCopper.length,
  pcbTraces: routes.length, vias: vias.length, copperPours: pours.length,
  geometryErrors, membershipErrors, missingCopper,
  findings: Object.fromEntries(Object.entries(findings).map(([name, values]) => [name, values.filter((v) => v.type.endsWith("_error")).length])),
  connectivityPolicy: "Native port continuity through traces, physical via spans and actual same-net pour/pad polygons, including holes and separate islands. Declared zone intent and fanout stubs alone do not count as complete nets.",
}
writeFileSync(join(folder, "assessment.json"), JSON.stringify(assessment, null, 2))
writeFileSync(join(folder, "findings.json"), JSON.stringify(findings, null, 2))
console.log(JSON.stringify({ ...assessment, geometryErrors: geometryErrors.length, membershipErrors: membershipErrors.length, missingCopper: missingCopper.length }))
