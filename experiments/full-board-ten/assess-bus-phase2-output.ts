import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { gunzipSync } from "node:zlib"

type Data = Record<string, any>

const [moduleArgument, outputArgument] = process.argv.slice(2)
assert(moduleArgument && outputArgument)
const modulePath = resolve(moduleArgument)
const outputDirectory = resolve(outputArgument)
const assessmentPath = resolve(outputDirectory, "physical-assessment.json")
const acceptedPath = resolve(outputDirectory, "completed-output.srj.json.gz")
if (!existsSync(acceptedPath)) {
  writeFileSync(assessmentPath, JSON.stringify({
    performed: false,
    status: "no-accepted-final-output",
    passed: false,
    scope: "No final physical completion result is available from this phase continuation.",
  }, null, 2) + "\n")
  process.exit(0)
}

const report = JSON.parse(readFileSync(resolve(outputDirectory, "report.json"), "utf8"))
assert(report.solved === true && report.failed === false)
const scenes = new Map<string, { value: Data; sha256: string }>()
for (const name of ["phase-1-input.srj.json.gz", "phase-2-input.srj.json.gz", "completed-output.srj.json.gz"]) {
  const bytes = gunzipSync(readFileSync(resolve(outputDirectory, name)))
  scenes.set(name, {
    value: JSON.parse(bytes.toString()),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  })
}
const prior = scenes.get("phase-1-input.srj.json.gz")!
const captured = scenes.get("phase-2-input.srj.json.gz")!
const accepted = scenes.get("completed-output.srj.json.gz")!
assert.equal(prior.sha256, "78871ac62e4fdc8f1e7ae7f7aed8cfd53e8a8336a7681371d7f9e9d3285380b6")
assert.equal(captured.sha256, "65254279ee79cb4df061b729ec567a60d39a23c1fedf2af18283773f23e9e642")
assert.equal(accepted.sha256, report.outputSha256)
assert.equal(captured.value.obstacles.length, 1720)
assert.deepEqual(prior.value.obstacles, captured.value.obstacles)
assert.equal(prior.value.connections.length, 8)
assert.equal(captured.value.connections.length, 8)
assert.equal(captured.value.traces.length, 16)
assert.equal(captured.value.layerCount, 8)
assert.equal(captured.value.allowBlindAndBuriedVias, false)

const circuit: Data[] = JSON.parse(gunzipSync(readFileSync(resolve(outputDirectory, "circuit.json.gz"))).toString())
const task = JSON.parse(readFileSync(resolve(dirname(outputDirectory), "cases/butterstick-spaced.json"), "utf8"))
const nativeBytes = readFileSync(task.sourcePath)
assert.equal(createHash("sha256").update(nativeBytes).digest("hex"), task.sourceSha256)
assert.equal(task.sourceSha256, "62b2e7b8716f92baf49e9d2c445e8b1eb07443343168c96a85970f33423d0fbf")
const native = JSON.parse(gunzipSync(nativeBytes).toString())
const nativeNets = new Map<string, Data>(native.traces.map((trace: Data) => [trace.name, trace]))
const nets = new Map(circuit.filter(row => row.type === "source_net").map(row => [row.source_net_id, row.name]))
const components = new Map(circuit.filter(row => row.type === "source_component").map(row => [row.source_component_id, row.name]))
const sourcePorts = new Map(circuit.filter(row => row.type === "source_port").map(row => [row.source_port_id, row]))
const pcbPorts = new Map(circuit.filter(row => row.type === "pcb_port").map(row => [row.pcb_port_id, row]))
const validationConnections = [...prior.value.connections, ...captured.value.connections]
assert.equal(new Set(validationConnections.map(connection => connection.name)).size, 16)
const identities: Data[] = []
for (const connection of validationConnections) {
  assert.equal(connection.pointsToConnect.length, 3)
  const nativeNet = nativeNets.get(nets.get(connection.name))
  assert(nativeNet)
  const endpoints: string[] = []
  for (const point of connection.pointsToConnect) {
    const pcbPort = pcbPorts.get(point.pcb_port_id)
    assert(pcbPort && Math.abs(pcbPort.x - point.x) < 1e-8 && Math.abs(pcbPort.y - point.y) < 1e-8)
    assert(pcbPort.layers.includes(point.layer))
    const sourcePort = sourcePorts.get(pcbPort.source_port_id)
    assert(sourcePort && sourcePort.pin_number !== undefined)
    endpoints.push(`.${components.get(sourcePort.source_component_id)} > .pin${sourcePort.pin_number}`)
    const pads = captured.value.obstacles.filter((obstacle: Data) =>
      obstacle.connectedTo.includes(point.pcb_port_id) && obstacle.componentId === pcbPort.pcb_component_id &&
      obstacle.layers.includes(point.layer) && Math.hypot(obstacle.center.x - point.x, obstacle.center.y - point.y) < 1e-8)
    assert.equal(pads.length, 1, "Each native terminal must retain its exact owned component pad")
  }
  assert.deepEqual([...endpoints].sort(), [...nativeNet.path].sort())
  identities.push({ connectionName: connection.name, nativeName: nativeNet.nativeNet, endpoints })
}
assert.deepEqual(identities.map(row => row.nativeName).sort(), Array.from({ length: 16 }, (_, index) => `/FPGA-DDR3L/DQ${index}`).sort())

const coreBytes = readFileSync(resolve(dirname(modulePath), "index.js"))
assert.equal(createHash("sha256").update(coreBytes).digest("hex"), "426044a899711814d034b6b0e3574e1de541252e03ed04263a3af83c610eb898")
const diagnosticBytes = readFileSync(modulePath)
assert(diagnosticBytes.subarray(0, coreBytes.length).equals(coreBytes))
assert.equal(createHash("sha256").update(diagnosticBytes).digest("hex"), "962fc9e75be5aca53dabd056c86a90977a67c43492c0b348e176a4157afac2fe")
const exposed = await import(pathToFileURL(modulePath).href)
const adapted = exposed.__busDiagAdapt(structuredClone(captured.value))
assert.deepEqual(adapted, captured.value, "This captured scene contains no through-obstacle copper requiring adaptation")
assert.deepEqual({ ...accepted.value, traces: [] }, { ...adapted, traces: [] })
assert.deepEqual(accepted.value.traces.slice(0, 16), adapted.traces)
assert.equal(new Set(accepted.value.traces.map((trace: Data) => trace.pcb_trace_id)).size, accepted.value.traces.length)
const priorNames = new Set(prior.value.connections.map((connection: Data) => connection.name))
assert(adapted.traces.every((trace: Data) => priorNames.has(trace.connection_name)))

// Ownership metadata is expanded only for assessment; the solver receives the original eight requests.
const validationInput = { ...adapted, connections: validationConnections }
const validationOutput = { ...accepted.value, connections: validationConnections }
const inputBefore = JSON.stringify(validationInput)
const outputBefore = JSON.stringify(validationOutput)
const drc = exposed.__busDiagDrc({
  inputSrj: validationInput,
  routedSrj: validationOutput,
  clearance: adapted.minTraceToPadEdgeClearance,
  allowBlindAndBuriedVias: false,
})
const connectivity = exposed.__busDiagConnectivity({ inputSrj: validationInput, routedSrj: validationOutput })
assert.equal(JSON.stringify(validationInput), inputBefore)
assert.equal(JSON.stringify(validationOutput), outputBefore)
assert.equal(connectivity.checkedConnectionCount, 16)
assert.equal(connectivity.checkedEndpointCount, 48)
const passed = drc.valid && connectivity.valid && connectivity.connectedConnectionCount === 16 && connectivity.connectedEndpointCount === 48
writeFileSync(assessmentPath, JSON.stringify({
  performed: true,
  status: passed ? "accepted-phase-output-physically-validated" : "accepted-phase-output-physical-validation-failed",
  passed,
  acceptedOutputSha256: accepted.sha256,
  capturedInputSha256: captured.sha256,
  nativeSourceSha256: task.sourceSha256,
  retainedPreloadsUnchanged: 16,
  obstacleCount: 1720,
  routingConnections: 8,
  routingTerminals: 24,
  validationConnections: 16,
  validationTerminals: 48,
  copperLayers: 8,
  allowBlindAndBuriedVias: false,
  identities,
  drc,
  connectivity,
  validationInputsUnchanged: true,
  scope: "Focused phase continuation with a fresh diagnostic window; not a full-board317 completion gain or performance comparison.",
}, null, 2) + "\n")
assert(passed, "Final phase output failed full-scene physical validation")
