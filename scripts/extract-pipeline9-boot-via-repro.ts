import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type {
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types/srj-types"

type CircuitRecord = { type: string; [key: string]: unknown }
type RecordedSrj = SimpleRouteJson & { allowBlindAndBuriedVias: boolean }
type RoutingEvent = {
  type: string
  subcircuit_id: string
  phaseOrdinal: number
  file: string
  autorouterVersion?: string
  solverName?: string
  effort?: number
}
type RecordedCapture = {
  node: string
  changedGeometry: Array<{
    rawAccepted: boolean
    canonicalAccepted: boolean
    rawRoutes: HighDensityRoute[]
  }>
}

function findOne({
  records,
  predicate,
  description,
}: {
  records: CircuitRecord[]
  predicate: (record: CircuitRecord) => boolean
  description: string
}): CircuitRecord {
  const matches = records.filter(predicate)
  assert.equal(matches.length, 1, `Expected exactly one ${description}`)
  return matches[0]!
}

function selectFields(
  record: CircuitRecord,
  fields: readonly string[],
): CircuitRecord {
  const selected: CircuitRecord = { type: record.type }
  for (const field of fields) {
    if (record[field] !== undefined) selected[field] = record[field]
  }
  return selected
}

const [runDirectoryArgument, capturesArgument] = process.argv.slice(2)
assert(
  runDirectoryArgument && capturesArgument,
  "Usage: bun scripts/extract-pipeline9-boot-via-repro.ts NATIVE_RUN_DIRECTORY CAPTURES_JSON",
)
const runDirectory = resolve(runDirectoryArgument)
const capturesPath = resolve(capturesArgument)
const circuit = JSON.parse(
  readFileSync(resolve(runDirectory, "circuit.json"), "utf8"),
) as CircuitRecord[]
const manifest = JSON.parse(
  readFileSync(resolve(runDirectory, "run.json"), "utf8"),
) as { events: RoutingEvent[] }
const captures = JSON.parse(
  readFileSync(capturesPath, "utf8"),
) as RecordedCapture[]
const inputEvents = manifest.events.filter(
  (event) =>
    event.type === "autorouting:start" &&
    event.subcircuit_id === "subcircuit_source_group_1",
)
const finalEvents = inputEvents.filter((event) => event.phaseOrdinal === 153)
assert.equal(finalEvents.length, 1, "Expected the recorded SoC phase153 input")
const inputEvent = finalEvents[0]!
const input = JSON.parse(
  readFileSync(resolve(runDirectory, inputEvent.file), "utf8"),
).simpleRouteJson as RecordedSrj
const inputHash = createHash("sha256")
  .update(JSON.stringify(input))
  .digest("hex")
assert.equal(
  inputHash,
  "3a047cbc0ef92ccb76f041ed0942d4e3a81b92e11ee79f284fe4bf6201ae6977",
  "This extractor targets the recorded south-interface reproduction, not another board revision",
)
const nodeCaptures = captures.filter((capture) => capture.node === "cmn_29")
assert.equal(nodeCaptures.length, 1)
const mismatch = nodeCaptures[0]!.changedGeometry.find(
  (capture) => capture.rawAccepted && !capture.canonicalAccepted,
)
assert(mismatch, "Expected an actual raw/canonical validation mismatch")
const candidateRoutes = mismatch.rawRoutes.filter(
  (route) => route.connectionName === "source_trace_122_fixed_100_0",
)
assert.equal(candidateRoutes.length, 1)
const candidateRoute = candidateRoutes[0]!
const nodeStagePath = resolve(
  runDirectory,
  "../phase153-sd-south-interface-diagnosis/captures.json",
)
const nodeStage = JSON.parse(readFileSync(nodeStagePath, "utf8")) as Array<{
  input: NodeWithPortPoints
}>
const matchingNodes = nodeStage
  .map((entry) => entry.input)
  .filter((node) => node.capacityMeshNodeId === "cmn_29")
assert.equal(matchingNodes.length, 1)
const nodeWithPortPoints = matchingNodes[0]!

const processor = findOne({
  records: circuit,
  predicate: (record) =>
    record.type === "source_component" && record.name === "U_SOC",
  description: "T113-S3 source component",
})
const resistor = findOne({
  records: circuit,
  predicate: (record) =>
    record.type === "source_component" && record.name === "R_BOOT_SEL1",
  description: "boot-selection resistor",
})
assert.equal(processor.manufacturer_part_number, "T113-S3")
assert.equal(resistor.manufacturer_part_number, "0402WGF3301TCE")
const sourceIds = new Set([
  processor.source_component_id,
  resistor.source_component_id,
])
const pcbComponents = circuit.filter(
  (record) =>
    record.type === "pcb_component" &&
    sourceIds.has(record.source_component_id),
)
assert.equal(pcbComponents.length, 2)
const pcbIds = new Set(pcbComponents.map((record) => record.pcb_component_id))
const resistorPcb = pcbComponents.find(
  (record) => record.source_component_id === resistor.source_component_id,
)!
const sourceTraces = circuit.filter(
  (record) =>
    record.type === "source_trace" &&
    ["source_trace_121", "source_trace_122"].includes(
      String(record.source_trace_id),
    ),
)
assert.equal(sourceTraces.length, 2)
const ground = findOne({
  records: circuit,
  predicate: (record) =>
    record.type === "source_net" && record.source_net_id === "source_net_14",
  description: "original GND net",
})
assert.equal(ground.name, "GND")

const circuitJson: CircuitRecord[] = [processor, resistor]
for (const record of circuit) {
  if (record.type === "pcb_component" && pcbIds.has(record.pcb_component_id)) {
    circuitJson.push(
      selectFields(record, [
        "pcb_component_id",
        "source_component_id",
        "center",
        "width",
        "height",
        "layer",
        "rotation",
      ]),
    )
  } else if (
    record.type === "source_port" &&
    sourceIds.has(record.source_component_id)
  ) {
    circuitJson.push(
      selectFields(record, [
        "source_port_id",
        "source_component_id",
        "name",
        "pin_number",
        "port_hints",
      ]),
    )
  } else if (
    record.type === "pcb_port" &&
    pcbIds.has(record.pcb_component_id)
  ) {
    circuitJson.push(
      selectFields(record, [
        "pcb_port_id",
        "source_port_id",
        "pcb_component_id",
        "x",
        "y",
        "layers",
      ]),
    )
  } else if (
    record.type === "pcb_smtpad" &&
    pcbIds.has(record.pcb_component_id)
  ) {
    circuitJson.push(
      selectFields(record, [
        "pcb_smtpad_id",
        "pcb_component_id",
        "pcb_port_id",
        "layer",
        "shape",
        "width",
        "height",
        "x",
        "y",
        "radius",
        "ccw_rotation",
        "port_hints",
      ]),
    )
  } else if (
    record.type.startsWith("pcb_courtyard_") &&
    pcbIds.has(record.pcb_component_id)
  ) {
    circuitJson.push(record)
  }
}
circuitJson.push(...sourceTraces, ground)
const obstacles = input.obstacles.filter(
  (obstacle) => obstacle.componentId === resistorPcb.pcb_component_id,
)
assert.equal(obstacles.length, 2, "Keep both original resistor pad obstacles")
const processorPadCount = circuit.filter(
  (record) =>
    record.type === "pcb_smtpad" &&
    record.pcb_component_id !== resistorPcb.pcb_component_id &&
    pcbIds.has(record.pcb_component_id),
).length
assert(
  processorPadCount >= 128,
  "Do not replace the processor by a partial pad drawing",
)
assert.equal(
  circuitJson.filter((record) => record.type === "pcb_smtpad").length,
  processorPadCount + 2,
)
const preloadedTraces = input.traces!.filter((trace) =>
  ["source_trace_121", "source_trace_122"].includes(trace.connection_name!),
)
assert(
  preloadedTraces.some((trace) => trace.connection_name === "source_trace_121"),
)
const originalGroundTrace = preloadedTraces.find(
  (trace) => trace.connection_name === "source_trace_122",
)
assert(originalGroundTrace)

const connections: SimpleRouteConnection[] = []
const connectionInputFiles: string[] = []
for (const event of inputEvents) {
  const eventInput = JSON.parse(
    readFileSync(resolve(runDirectory, event.file), "utf8"),
  ).simpleRouteJson as SimpleRouteJson
  for (const connection of eventInput.connections) {
    if (!["source_trace_121", "source_trace_122"].includes(connection.name)) {
      continue
    }
    assert(!connections.some((previous) => previous.name === connection.name))
    connections.push(connection)
    connectionInputFiles.push(event.file)
  }
}
assert.equal(
  connections.length,
  2,
  "Keep the actual earlier-phase native connections",
)

const fixture = {
  provenance: {
    description:
      "Actual T113-S3 boot resistor and captured Pipeline9 regional candidate; " +
      "not a fabricated route or a freshly solved minimal board.",
    run: basename(runDirectory),
    inputFile: inputEvent.file,
    inputHash,
    inputHashBasis: "SHA256 of JSON.stringify(event.simpleRouteJson)",
    connectionInputFiles,
    captureFile: `${basename(dirname(capturesPath))}/${basename(capturesPath)}`,
    nodeInputFile: `${basename(dirname(nodeStagePath))}/${basename(nodeStagePath)}`,
    node: "cmn_29",
    candidateConnectionName: candidateRoute.connectionName,
    originalSourceTraceId: "source_trace_122",
    originalPcbTraceId: originalGroundTrace.pcb_trace_id,
    originalSourceNetId: "source_net_14",
    sourceVersions: {
      core: "0.0.1861",
      capacityAutorouter: "0.0.886",
      fanoutSolver: "0.0.66",
    },
    instrumentation:
      "Recorded using isolated experimental source runtimes. Process-local " +
      "observer called native candidate validation on raw and materialized " +
      "route objects; raw was accepted and canonical was rejected. No " +
      "candidate coordinates or pad geometry were edited. This does not " +
      "assert whole-board success or pristine published-runtime behavior.",
    circuitSelection:
      "Complete original processor and resistor SMT pads and source/PCB " +
      "ports. Unrelated circuit components and non-geometric display/group " +
      "fields are omitted; retained values are unchanged.",
    processorPadCount,
    layerCount: input.layerCount,
    allowBlindAndBuriedVias: input.allowBlindAndBuriedVias,
    viaToPadClearance: input.minViaEdgeToPadEdgeClearance,
    minViaDiameter: input.minViaDiameter,
    minViaHoleDiameter: input.minViaHoleDiameter,
    omittedCandidateContext:
      "Five other SD signal routes share the captured regional candidate. " +
      "The fixture isolates the recorded ground-route geometry calculation, " +
      "not the complete regional search.",
  },
  circuitJson,
  candidateRoute,
  nodeWithPortPoints,
  preloadedTraces,
  obstacles,
  connections,
}
const outputPath = resolve(
  import.meta.dir,
  "../tests/repro/assets/pipeline9-boot-via-candidate.json",
)
mkdirSync(dirname(outputPath), { recursive: true })
const serialized = `${JSON.stringify(fixture)}\n`
assert(
  !serialized.includes(runDirectory) &&
    !serialized.includes(dirname(capturesPath)),
  "Do not publish host-local absolute paths",
)
writeFileSync(outputPath, serialized)
console.log(
  JSON.stringify(
    {
      output: "tests/repro/assets/pipeline9-boot-via-candidate.json",
      bytes: Buffer.byteLength(serialized),
      records: circuitJson.length,
      processorPadCount,
      resistorPads: obstacles.length,
      inputHash,
    },
    null,
    2,
  ),
)
