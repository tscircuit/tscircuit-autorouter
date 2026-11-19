import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync, unlinkSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { gunzipSync, gzipSync } from "node:zlib"

type Data = Record<string, any>
const [rootArg, inputArg, outputArg, variant] = process.argv.slice(2)
assert(rootArg && inputArg && outputArg && ["baseline", "base", "candidate"].includes(variant!))
const root = resolve(rootArg), inputDirectory = resolve(inputArg), output = resolve(outputArg)
const controller = import.meta.dir
const plan = JSON.parse(readFileSync(resolve(controller, "a03-via-gate-screen-plan.json"), "utf8"))
assert.equal(plan.qualificationReady, true)
const sha = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex")
const load = (name: string): Data => JSON.parse(gunzipSync(readFileSync(resolve(inputDirectory, name))).toString())
mkdirSync(output, { recursive: true })
const report = variant === "baseline" ? null : JSON.parse(readFileSync(resolve(output, "report.json"), "utf8"))
if (report && (!report.solved || report.failed || report.timedOut || report.thrownError || !report.outputSha256)) {
  writeFileSync(resolve(output, "physical-assessment.json"), JSON.stringify({ performed: false, passed: false, status: "no-accepted-final-phase-output", wholeBoardCompletionClaim: false }, null, 2) + "\n")
  process.exit(0)
}
const original = load("phase-4-input.srj.json.gz")
const originalCircuit: Data[] = load("circuit.json.gz") as any
const busOutput = load("phase-2-output.srj.json.gz")
const accepted = variant === "baseline" ? structuredClone(original) : JSON.parse(gunzipSync(readFileSync(resolve(output, "phase-output.srj.json.gz"))).toString())
if (report) assert.equal(sha(gunzipSync(readFileSync(resolve(output, "phase-output.srj.json.gz")))), report.outputSha256)
assert.deepEqual({ ...accepted, traces: [] }, { ...original, traces: [] }, "Accepted phase output changed native input geometry or demands")
assert.equal(original.obstacles.length, 1695)
const phases = [1, 2, 3, 4].map(index => load(`phase-${index}-input.srj.json.gz`))
const obligations = phases.flatMap(phase => phase.connections)
assert.equal(obligations.length, 109)
assert.equal(new Set(obligations.map(connection => connection.name)).size, 109)
assert.equal(obligations.reduce((count, connection) => count + connection.pointsToConnect.length, 0), 253)
const busNames = new Set(phases.slice(0, 2).flatMap(phase => phase.connections.map((connection: Data) => connection.name)))
assert.equal(busNames.size, 16)
assert.equal(busOutput.traces.length, 16)
const immutableTraces = originalCircuit.filter(row => row.type === "pcb_trace" && busNames.has(row.connection_name))
assert.equal(immutableTraces.length, 16)
const immutableTraceIds = new Set(immutableTraces.map(row => row.pcb_trace_id))
const immutableVias = originalCircuit.filter(row => row.type === "pcb_via" && immutableTraceIds.has(row.pcb_trace_id))
assert.equal(immutableVias.length, 32)
const fixedGeometry = originalCircuit.filter(row => row.type !== "pcb_trace" && row.type !== "pcb_via")
const manifest = JSON.parse(readFileSync(resolve(root, "runtime-manifest.json"), "utf8"))
const core = manifest.packages.find((row: Data) => row.name === "@tscircuit/core")
const checks = resolve(root, "runtime/node_modules/@tscircuit/checks/dist/index.js")
assert.equal(sha(readFileSync(checks)), "8586d47befd95cce0aeb33eb7e1defc315e2cdc62168673ea80019aaacc4b880")
const coreBytes = readFileSync(core.entry)
assert.equal(sha(coreBytes), "f8122fb04b46cb37bf48de0f8642044bc8360937a03630e4655112cc8694471b")
const tail = "\nexport { su5 as assessmentDatabase, getCircuitJsonPcbTraceRoute, getSourceTraceIdForRoutedTrace, ensureRouteStartsAtSourceTraceStart, getAutoroutedViaLayers, pcbViasSharePhysicalHole };\n"
const helper = resolve(inputDirectory, "assessment-core")
mkdirSync(helper, { recursive: true })
const helperFiles: Data[] = []
for (const name of readdirSync(dirname(core.entry)).filter(name => name.endsWith(".js"))) {
  const before = readFileSync(resolve(dirname(core.entry), name))
  const after = name === "index.js" ? Buffer.concat([before, Buffer.from(tail)]) : before
  const path = resolve(helper, name)
  if (existsSync(path)) assert.deepEqual(readFileSync(path), after)
  else writeFileSync(path, after)
  helperFiles.push({ name, originalSha256: sha(before), outputSha256: sha(after), exactPublishedPrefix: true })
}
if (!existsSync(resolve(helper, "package.json"))) writeFileSync(resolve(helper, "package.json"), '{"name":"published-core-assessment-only","private":true,"type":"module"}\n')
if (!existsSync(resolve(helper, "node_modules"))) symlinkSync(resolve(root, "runtime/node_modules"), resolve(helper, "node_modules"))
writeFileSync(resolve(inputDirectory, "assessment-helper-proof.json"), JSON.stringify({ assessmentOnly: true, routingNeverImportsHelper: true, publishedCoreSha256: sha(coreBytes), exportTail: tail, files: helperFiles }, null, 2) + "\n")
const native = await import(pathToFileURL(resolve(helper, "index.js")).href)
const circuit = structuredClone([...fixedGeometry, ...immutableTraces, ...immutableVias])
const db = native.assessmentDatabase(circuit)
const board = db.pcb_board.list()[0]
const traceIds = new Set(immutableTraceIds)
const allOldVias = originalCircuit.filter(row => row.type === "pcb_via")
const vias = db.pcb_via.list()
for (const source of accepted.traces) {
  assert.equal(source.type, "pcb_trace")
  assert(!traceIds.has(source.pcb_trace_id), "Duplicate output trace ID or attempt to replace immutable DDR copper")
  traceIds.add(source.pcb_trace_id)
  assert(obligations.some(connection => connection.name === source.connection_name), "Unknown accepted trace owner")
  const trace = structuredClone(source)
  trace.subcircuit_id = board.subcircuit_id
  const converted = trace.route.map((point: Data) => {
    assert(["wire", "via", "through_obstacle"].includes(point.route_type), "Unsupported accepted route geometry")
    return point.route_type !== "through_obstacle" ? point : { route_type: "through_pad", start: point.start, end: point.end, start_layer: point.from_layer, end_layer: point.to_layer, width: point.width, circuitJsonMetadata: point.circuitJsonMetadata }
  })
  const sourceTraceId = native.getSourceTraceIdForRoutedTrace({ db, trace: { ...trace, route: converted }, subcircuit_id: board.subcircuit_id })
  assert(sourceTraceId, "Native conversion could not assign accepted copper to a source net")
  const route = native.ensureRouteStartsAtSourceTraceStart({ db, route: converted, routeThicknessMode: trace.route_thickness_mode, sourceTraceId })
  db.pcb_trace.insert({ ...trace, source_trace_id: sourceTraceId, route: native.getCircuitJsonPcbTraceRoute(route) })
  const sourceTrace = db.source_trace.get(sourceTraceId)
  const sourceNet = db.source_net.get(trace.connection_name)
  assert(sourceNet)
  assert(sourceTraceId === trace.connection_name || sourceTrace?.connected_source_net_ids.includes(trace.connection_name), "Native trace conversion changed electrical owner")
  const connectivityKey = sourceTrace?.subcircuit_connectivity_map_key ?? sourceNet.subcircuit_connectivity_map_key
  for (const point of route.filter((point: Data) => point.route_type === "via")) {
    const via = { type: "pcb_via", pcb_trace_id: trace.pcb_trace_id, x: point.x, y: point.y, hole_diameter: point.via_hole_diameter ?? point.hole_diameter ?? board.min_via_hole_diameter, outer_diameter: point.via_diameter ?? point.outer_diameter ?? board.min_via_pad_diameter, layers: native.getAutoroutedViaLayers({ fromLayer: point.from_layer, toLayer: point.to_layer, layerCount: original.layerCount, allowBlindAndBuriedVias: original.allowBlindAndBuriedVias, physicalLayers: point.layers }), from_layer: point.from_layer, to_layer: point.to_layer, subcircuit_id: board.subcircuit_id, subcircuit_connectivity_map_key: connectivityKey }
    if (vias.some((existing: Data) => native.pcbViasSharePhysicalHole(existing, via))) continue
    const old = allOldVias.find(existing => native.pcbViasSharePhysicalHole(existing, via))
    const inserted = db.pcb_via.insert({ ...via, pcb_via_id: old?.pcb_via_id ?? `uniform_${variant}_via_${vias.length}` })
    if (!vias.includes(inserted)) vias.push(inserted)
  }
}
assert.deepEqual(circuit.filter(row => row.type !== "pcb_trace" && row.type !== "pcb_via"), fixedGeometry)
assert.deepEqual(circuit.filter(row => row.type === "pcb_trace" && immutableTraceIds.has(row.pcb_trace_id)), immutableTraces)
assert.deepEqual(circuit.filter(row => row.type === "pcb_via" && immutableTraceIds.has(row.pcb_trace_id)), immutableVias)
const pcbPorts = new Map(circuit.filter(row => row.type === "pcb_port").map(row => [row.pcb_port_id, row]))
for (const connection of obligations) for (const point of connection.pointsToConnect) {
  const port = pcbPorts.get(point.pcb_port_id)
  assert(port && Math.hypot(port.x - point.x, port.y - point.y) < 1e-8 && port.layers.includes(point.layer), "Original demanded endpoint changed")
}
const circuitBytes = Buffer.from(JSON.stringify(circuit))
writeFileSync(resolve(output, "circuit.json"), circuitBytes)
const assessor = resolve(root, "sources/spaced/scripts/assess.ts")
assert.equal(sha(readFileSync(assessor)), "061962dbb8deace443531b0d95a2d3c804a7d0e7fd8c5ee635f18136c219923f")
const assessorProcess = Bun.spawn([Bun.which("bun")!, assessor, resolve(root, "runtime"), "h616", output, "full-board"], { stdout: "inherit", stderr: "inherit" })
assert.equal(await assessorProcess.exited, 0, "Immutable native assessor failed")
const assessment = JSON.parse(readFileSync(resolve(output, "assessment.json"), "utf8"))
const findings = JSON.parse(readFileSync(resolve(output, "findings.json"), "utf8"))
const physicalNames = ["trace_overlap", "pad_trace", "via_trace", "via_pad", "via_spacing", "contiguous", "via_in_pad", "hole_trace", "width"]
const physicalFindings = Object.fromEntries(physicalNames.map(name => [name, assessment.findings[name]]))
function canonicalFinding(value: any): any {
  if (typeof value === "number") return Math.round(value * 1e9) / 1e9
  if (Array.isArray(value)) return value.map(canonicalFinding)
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().filter(key => key !== "message" && !key.endsWith("_error_id")).map(key => [key, canonicalFinding(value[key])]))
  return value
}
const physicalKeys = (values: Data): string[] => physicalNames.flatMap(kind => values[kind].filter((finding: Data) => finding.type.endsWith("_error")).map((finding: Data) => JSON.stringify({ kind, finding: canonicalFinding(finding) }))).sort()
const baselineFindings = load("findings.json.gz")
const oldPhysicalKeys = physicalKeys(baselineFindings)
const currentPhysicalKeys = physicalKeys(findings)
const newPhysicalFindings = currentPhysicalKeys.filter(key => !oldPhysicalKeys.includes(key))
const resolvedPhysicalFindings = oldPhysicalKeys.filter(key => !currentPhysicalKeys.includes(key))
if (variant === "baseline") {
  assert.deepEqual(currentPhysicalKeys, oldPhysicalKeys, "Baseline physical finding identities/geometry changed")
  const recordedAssessment = JSON.parse(readFileSync(resolve(inputDirectory, "assessment.json"), "utf8"))
  assert.deepEqual([...assessment.unconnectedNets].sort(), [...recordedAssessment.unconnectedNets].sort(), "Baseline connected native identities changed")
  assert.equal(assessment.connectedNets, 53)
  assert.equal(assessment.requestedNets, 121)
  assert.deepEqual(assessment.geometryErrors, [])
  assert.deepEqual(physicalFindings, { trace_overlap: 1, pad_trace: 0, via_trace: 1, via_pad: 1, via_spacing: 0, contiguous: 0, via_in_pad: 0, hole_trace: 0, width: 0 })
} else {
  const qualification = JSON.parse(readFileSync(resolve(root, "a03-via-gate/baseline/physical-assessment.json"), "utf8"))
  assert(qualification.baselineQualified)
}
const netNames = new Map(circuit.filter(row => row.type === "source_net").map(row => [row.source_net_id, row.name]))
const nativeSource = JSON.parse(gunzipSync(readFileSync(resolve(root, "sources/spaced/full-boards/h616.json.gz"))).toString())
const nativeNames = new Map(nativeSource.traces.map((trace: Data) => [trace.name, trace.nativeNet]))
const disconnected = new Set(assessment.unconnectedNets)
const rows = obligations.map(connection => ({ connection: connection.name, nativeName: nativeNames.get(netNames.get(connection.name)), active: original.connections.some((active: Data) => active.name === connection.name) }))
assert(rows.every(row => typeof row.nativeName === "string"))
const lostOrUnfinished = rows.filter(row => disconnected.has(row.nativeName))
const phaseConnected = rows.filter(row => row.active && !disconnected.has(row.nativeName)).length
const priorConnected = rows.filter(row => !row.active && !disconnected.has(row.nativeName)).length
writeFileSync(resolve(output, "circuit.json.gz"), gzipSync(circuitBytes))
writeFileSync(resolve(output, "physical-assessment.json"), JSON.stringify({ performed: true, baselineQualified: variant === "baseline", phaseSolved: variant !== "baseline", acceptedOutputSha256: report?.outputSha256 ?? null, circuitSha256: sha(circuitBytes), originalGeometryPreserved: true, immutableDdrTraces: 16, immutableDdrVias: 32, originalPhaseObstacles: 1695, allNativeDemands: 109, activeConnected: phaseConnected, activeRequested: 56, priorConnected, priorRequested: 53, lostOrUnfinished, nativeAssessment: assessment, physicalFindings, canonicalPhysicalFindings: currentPhysicalKeys, newPhysicalFindings, resolvedPhysicalFindings, existingBaselinePhysicalFindings: plan.assessment.baselineExistingPhysicalFindings, allDemandedConnectionsConnected: lostOrUnfinished.length === 0, wholeBoardCompletionClaim: false, helper: { publishedCoreSha256: sha(coreBytes), exportTail: tail, files: helperFiles }, scope: "Assessment-only reconstruction using published Core materialization helpers and the unchanged native spaced assessor/checks282. Original 3 physical defects remain baseline findings; accepted phase completion alone is not a clean full-board result." }, null, 2) + "\n")
unlinkSync(resolve(output, "circuit.json"))
console.log(JSON.stringify({ variant, baselineQualified: variant === "baseline", activeConnected: phaseConnected, priorConnected, physicalFindings }))
