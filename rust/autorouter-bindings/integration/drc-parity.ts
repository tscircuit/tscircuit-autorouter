import { importReference } from "./tsReference"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
const { AutoroutingDrcEngine } = await importReference<typeof import("high-density-repair03/lib/drc/AutoroutingDrcEngine")>("node_modules/high-density-repair03/lib/drc/AutoroutingDrcEngine.ts")
import type { AutoroutingDrcEngineOptions } from "high-density-repair03/lib/drc/AutoroutingDrcEngine"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "high-density-repair03/lib/types"
import { loadScenarioBySampleNumber } from "../../../scripts/benchmark/scenarios"
import { getConnectivityMapFromSimpleRouteJson } from "../../../lib/utils/getConnectivityMapFromSimpleRouteJson"
import * as bindings from "../pkg/autorouter_bindings.js"
import { loadAutorouterBindings } from "../ts/index"
import { AutoroutingDrcEngine } from "../../../lib/bindings/repair/AutoroutingDrcEngine"

type Point = { x: number; y: number }
type Fixture = {
  name: string
  srj: SimpleRouteJson
  traces: SimplifiedPcbTraces
  options?: AutoroutingDrcEngineOptions
}

// Small fixtures adapted from high-density-repair03/tests/autorouting-drc-engine-
// edge-cases.test.ts, autorouting-drc-engine-connmap-canonical-alias.test.ts,
// autorouting-drc-via-span-pad.test.ts and autorouting-drc-via-endpoint-span.test.ts.
function createSrj(overrides: Partial<SimpleRouteJson> = {}): SimpleRouteJson {
  return {
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    connections: ["net_a", "net_b"].map((name) => ({ name, pointsToConnect: [] })),
    obstacles: [], layerCount: 2, minTraceWidth: 0.1, minViaDiameter: 0.3,
    ...overrides,
  }
}

function wire(traceId: string, connectionName: string, points: Point[], layer = "top"): SimplifiedPcbTraces[number] {
  return {
    type: "pcb_trace", pcb_trace_id: traceId, connection_name: connectionName,
    route: points.map((point) => ({ route_type: "wire", ...point, width: 0.1, layer })),
  }
}

function checkBytes(actual: unknown, expected: unknown, label: string): void {
  const actualBytes = JSON.stringify(actual)
  const expectedBytes = JSON.stringify(expected)
  let first = 0
  while (first < Math.min(actualBytes.length, expectedBytes.length) && actualBytes[first] === expectedBytes[first]) first++
  assert.ok(actualBytes === expectedBytes,
    `${label}: first differing byte ${first}\nTS: ${expectedBytes.slice(Math.max(0, first - 60), first + 160)}\nWASM: ${actualBytes.slice(Math.max(0, first - 60), first + 160)}`)
}

function runFixture({ name, srj, traces, options = {} }: Fixture): void {
  const { connMap, ...rawOptions } = options
  const expected = new AutoroutingDrcEngine(srj, options)
  const rawMap: unknown = connMap === undefined ? undefined : JSON.parse(JSON.stringify(connMap))
  const actual = new bindings.AutoroutingDrcEngine(srj, rawMap, rawOptions)
  const adapter = new AutoroutingDrcEngine(srj, options)
  const originalInput = JSON.stringify({ srj, traces })
  try {
    checkBytes(actual.stats(), expected.lastRunStats, `${name} initial stats`)
    // Change dynamic geometry and mode on one persistent engine, including reset
    // to empty input and restoring its original geometry after reordered input.
    const calls: Array<{ input: SimplifiedPcbTraces; complete: boolean }> = [
      { input: traces, complete: true },
      { input: traces, complete: false },
      { input: [], complete: true },
      { input: [...traces].reverse(), complete: true },
      { input: traces, complete: true },
    ]
    for (const [index, { input, complete }] of calls.entries()) {
      const reference = complete ? expected.evaluate(input) : expected.evaluateLegacy(input)
      checkBytes(actual.evaluate(input, complete), reference, `${name} call ${index} results`)
      checkBytes(complete ? adapter.evaluate(input) : adapter.evaluateLegacy(input), reference, `${name} call ${index} adapter results`)
      checkBytes(adapter.lastRunStats, expected.lastRunStats, `${name} call ${index} adapter stats`)
      checkBytes(actual.stats(), expected.lastRunStats, `${name} call ${index} stats`)
    }
    assert.equal(JSON.stringify({ srj, traces }), originalInput, `${name} input mutation`)
    console.log(`${name}: ${calls.length} persistent evaluations, complete result bytes and stats identical`)
  } finally {
    actual.free()
  }
}

await loadAutorouterBindings({ module_or_path: readFileSync(new URL("../pkg/autorouter_bindings_bg.wasm", import.meta.url)) })
const horizontal = wire("trace_a", "net_a", [{ x: -1, y: 0 }, { x: 1, y: 0 }])
const fixtures: Fixture[] = []
for (const separation of [0, 0.19, 0.195, 0.196, 0.2]) {
  fixtures.push({ name: `boundary-${separation}`, srj: createSrj(), traces: [horizontal,
    wire("trace_b", "net_b", [{ x: -1, y: separation }, { x: 1, y: separation }])] })
}
fixtures.push({ name: "worst-contact-order", srj: createSrj(), traces: [
  wire("trace_a", "net_a", [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.15 }, { x: -1, y: 0.15 }]),
  wire("trace_b", "net_b", [{ x: -0.5, y: 0.18 }, { x: 0.5, y: 0.18 }]),
  wire("trace_c", "net_c", [{ x: 0, y: -1 }, { x: 0, y: 1 }]),
] })
fixtures.push({ name: "different-layers-degenerate", srj: createSrj(), traces: [horizontal,
  wire("trace_b", "net_b", [{ x: 0, y: -1 }, { x: 0, y: 1 }], "bottom"),
  wire("trace_c", "net_c", [{ x: 0, y: 0 }, { x: 0, y: 0 }]),
] })

for (const angle of [0, 30, 45, 90, -17.3, 123.456]) {
  fixtures.push({ name: `rotated-pads-${angle}`, srj: createSrj({ obstacles: [
    { type: "rect", layers: ["top"], center: { x: 0.125, y: -0.0625 }, width: 0.9, height: 0.3,
      ccwRotationDegrees: angle, connectedTo: ["pcb_port_rotated"] },
    { type: "rect", layers: ["top", "bottom"], center: { x: 0.6, y: 0.05 }, width: 0.3, height: 0.3,
      connectedTo: ["pcb_plated_hole_circle"] },
  ] }), traces: [horizontal, wire("trace_b", "net_b", [{ x: 0.2, y: -1 }, { x: 0.2, y: 1 }])],
  options: { includeTraceViaOwnerMetadata: true, spatialCellSize: 0.3 } })
}

for (const mode of ["full", "partial", "foreign"] as const) {
  const connMap = new ConnectivityMap({})
  const port = `pcb_port_${mode}`
  connMap.addConnections([mode === "partial" ? ["root_net", "source_trace_partial"] : ["root_net", "pcb_port_full"]])
  fixtures.push({ name: `canonical-alias-${mode}`, srj: createSrj({
    connections: [{ name: mode === "partial" ? "root_net" : `${mode}_split_pair`, pointsToConnect: [
      { x: 0, y: 0, layer: "top", pointId: port },
      { x: 0, y: 0.5, layer: "top", pointId: `${port}_other` },
    ] }],
    obstacles: [{ type: "rect", layers: ["top"], center: { x: 0, y: 0 }, width: 0.5, height: 0.5,
      connectedTo: [`pcb_smtpad_${port}`, port] }],
  }), traces: [wire("trace_0", "root_net", [{ x: -1, y: 0 }, { x: 1, y: 0 }])], options: { connMap } })
}

for (const reversed of [false, true]) {
  for (const padLayer of ["inner1", "bottom"]) {
    const via: SimplifiedPcbTraces[number] = { type: "pcb_trace", pcb_trace_id: "power", connection_name: "power",
      route: [{ route_type: "via", x: 0, y: 0, from_layer: reversed ? "inner2" : "top", to_layer: reversed ? "top" : "inner2" }] }
    fixtures.push({ name: `via-span-${reversed ? "reversed" : "forward"}-${padLayer}`, srj: createSrj({ layerCount: 4,
      obstacles: [{ type: "rect", layers: [padLayer], center: { x: 0, y: 0 }, width: 0.2, height: 0.2,
        connectedTo: ["pcb_smtpad_foreign"] }],
    }), traces: [via,
      wire("signal", "signal", [{ x: -1, y: 0 }, { x: 1, y: 0 }], "inner1"),
      { ...via, pcb_trace_id: "nearby", connection_name: "foreign", route: [
        { route_type: "via", x: 0.32, y: 0, from_layer: "top", to_layer: "bottom", via_diameter: 0.3 },
      ] },
      { ...via, pcb_trace_id: "coincident", connection_name: "foreign" },
    ], options: { includeTraceViaOwnerMetadata: true, viaClearance: 0.01 } })
  }
}
for (const fixture of fixtures) runFixture(fixture)

// Optional real-board replay: --trace-dir <directory with 2.json,8.json,12.json>
// --samples 2,8,12. Inputs use the same migrated SRJ loader as the benchmark.
const args = process.argv.slice(2)
const traceDirIndex = args.indexOf("--trace-dir")
if (traceDirIndex !== -1) {
  const traceDir = args[traceDirIndex + 1]
  assert.ok(traceDir, "--trace-dir requires a directory")
  const samplesIndex = args.indexOf("--samples")
  const sampleNumbers = (samplesIndex === -1 ? "2,8,12" : args[samplesIndex + 1]!).split(",").map(Number)
  for (const sampleNumber of sampleNumbers) {
    const { scenario } = await loadScenarioBySampleNumber("srj18", sampleNumber, 1)
    const traces = JSON.parse(readFileSync(join(traceDir, `${sampleNumber}.json`), "utf8")) as SimplifiedPcbTraces
    runFixture({ name: `srj18-${sampleNumber}`, srj: scenario as SimpleRouteJson, traces,
      options: { connMap: getConnectivityMapFromSimpleRouteJson(scenario), includeTraceViaOwnerMetadata: true } })
  }
}
