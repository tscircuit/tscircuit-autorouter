import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import type { AnyCircuitElement } from "circuit-json"
import { checkTracesAreContiguous } from "../../../lib/bindings/checkTracesAreContiguous"
import { convertToCircuitJson } from "../../../lib/testing/utils/convertToCircuitJson"
import { loadScenarioBySampleNumber } from "../../../scripts/benchmark/scenarios"
import { importReference } from "./tsReference"

const { checkTracesAreContiguous: reference } = await importReference<{ checkTracesAreContiguous: typeof checkTracesAreContiguous }>("node_modules/@tscircuit/checks/dist/index.js")

function compare(label: string, elements: unknown[]): void {
  const circuit = elements as AnyCircuitElement[]
  const before = structuredClone(circuit)
  const run = (check: typeof reference): ReturnType<typeof reference> | Error => {
    try { return check(circuit) } catch (error) {
      assert.ok(error instanceof Error)
      return error
    }
  }
  const expected = run(reference)
  const actual = run(checkTracesAreContiguous)
  if (expected instanceof Error || actual instanceof Error) {
    assert.ok(expected instanceof Error && actual instanceof Error, label)
    assert.equal(actual.name, expected.name, `${label}: error type`)
    assert.equal(actual.message, expected.message, `${label}: error message`)
    assert.deepEqual(circuit, before, `${label}: input unchanged`)
    console.log(`${label}: exact exception ${actual.message}`)
    return
  }
  assert.deepEqual(actual, expected, label)
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), `${label}: ordered JSON`)
  assert.deepEqual(circuit, before, `${label}: input unchanged`)
  console.log(`${label}: ${actual.length} exact errors`)
}

const wire = (x: number, y: number): object => ({ route_type: "wire", x, y, width: 0.1, layer: "top" })
const trace = (id: string, route: object[], source?: string): object => ({ type: "pcb_trace", pcb_trace_id: id, source_trace_id: source, route })
compare("empty", [])
compare("unassociated-pad-geometry", [{ type: "pcb_smtpad", shape: "polygon" }, trace("unused-pad", [wire(0, 0)])])
compare("endpoints-rounding", [trace("a", [wire(-0, -0.005), wire(1.005, 1e21)]), trace("\ud800\u0000", [wire(1, 2), wire(1, 2)]), trace("\u0000trace-contiguity:abcd", [wire(3, 4)])])
compare("nonfinite", [trace("finite-tags", [wire(NaN, Infinity), wire(-Infinity, -0)])])
const opaque: { self?: unknown; value: bigint } = { value: 12345678901234567890n }
opaque.self = opaque
compare("opaque-metadata", [{ ...trace("metadata", [{ ...wire(1, 2), opaque }, wire(3, 4)]), opaque }, { type: "pcb_component", pcb_component_id: "unused", opaque }])
compare("via-alignment", [trace("via", [wire(0, 0), { route_type: "via", x: 0.01, y: 0, from_layer: "top", to_layer: "bottom" }, wire(0.01, 0)])])
const port = { type: "pcb_port", pcb_port_id: "port", source_port_id: "source_port", x: 0, y: 0, layers: ["top"] }
const pad = { type: "pcb_smtpad", pcb_smtpad_id: "pad", pcb_port_id: "port", shape: "rect", x: 0, y: 0, width: 1, height: 1, layer: "top" }
const source = { type: "source_trace", source_trace_id: "source", connected_source_port_ids: ["source_port"] }
compare("missing-expected", [port, pad, source, trace("expected", [wire(2, 0), wire(3, 0)], "source")])
compare("source-fragments", [port, pad, source, trace("expected", [wire(2, 0), wire(3, 0)], "source"), trace("other", [wire(0, 0), wire(2, 0)], "source")])
for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty", "0", "2"]) {
  compare(`builtin-trace-${id}`, [port, pad, source, trace(id, [wire(2, 0), wire(3, 0)], "source"), trace("connected", [{ ...wire(0, 0), start_pcb_port_id: "port" }, wire(2, 0)], "source")])
  compare(`builtin-network-${id}`, [port, pad, source, { ...source, source_trace_id: "other-source" }, trace(id, [{ ...wire(2, 0), start_pcb_port_id: "bridge" }, wire(3, 0)], "source"), trace("candidate", [{ ...wire(0, 0), start_pcb_port_id: "bridge", end_pcb_port_id: "port" }, wire(1, 0)], "other-source")])
  compare(`builtin-port-${id}`, [{ ...port, pcb_port_id: id }, { ...pad, pcb_port_id: id }, source, trace("target", [{ ...wire(2, 0), start_pcb_port_id: id }, wire(3, 0)], "source")])
}
compare("duplicate-trace-ids", [port, pad, source, trace("duplicate", [wire(2, 0), wire(3, 0)], "source"), trace("duplicate", [wire(0, 0), wire(2, 0)], "other-source"), { ...source, source_trace_id: "other-source" }, trace("later", [wire(4, 0), wire(5, 0)], "source")])
compare("duplicate-port-ids", [port, { ...port, source_port_id: "different-source-port", x: 4 }, pad, source, trace("duplicate-port", [wire(2, 0), wire(3, 0)], "source")])
compare("duplicate-source-vias", [port, pad, source, trace("first", [wire(2, 0), wire(3, 0)], "source"), trace("second", [wire(2, 0), { route_type: "via", x: 3, y: 0, from_layer: "top", to_layer: "bottom" }, wire(3, 0)], "source")])
for (const shape of ["circle", "rect", "rotated_rect", "pill", "rotated_pill", "polygon"] as const) {
  compare(`pad-${shape}`, [port, { ...pad, shape, radius: 0.5, ccw_rotation: 45, points: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }] }, trace(shape, [wire(0, 0), wire(0.5, 0)])])
}
for (const shape of ["circle", "oval", "pill", "circular_hole_with_rect_pad", "pill_hole_with_rect_pad"] as const) {
  compare(`hole-${shape}`, [port, { type: "pcb_plated_hole", pcb_plated_hole_id: "hole", pcb_port_id: "port", shape, x: 0, y: 0, outer_diameter: 1, outer_width: 1, outer_height: 0.5, rect_pad_width: 1, rect_pad_height: 0.5, rect_ccw_rotation: 30, layers: ["top", "bottom"] }, trace(shape, [wire(0, 0), wire(0.5, 0)])])
}
compare("through-pad-center", [port, pad, source, trace("through", [{ route_type: "through_pad", start: { x: 2, y: 2 }, end: { x: 3, y: 3 }, pcb_port_id: "other", layer: "top" }], "source")])
compare("expected-negative-zero", [{ ...port, x: 5 }, { ...pad, x: 5 }, source, trace("zero", [{ ...wire(-0, -0), start_pcb_port_id: "port" }, wire(2, 3)], "source")])
const tracesDir = process.argv[2]
if (tracesDir) assert.ok(existsSync(tracesDir), `Trace directory does not exist: ${tracesDir}`)
for (let sample = 1; sample <= 16; sample++) {
  const { scenario } = await loadScenarioBySampleNumber("srj18", sample, 1)
  const filename = tracesDir === undefined ? undefined : `${tracesDir}/${sample}.json`
  const hasRoutedOutput = filename !== undefined && existsSync(filename)
  const routes = hasRoutedOutput ? JSON.parse(readFileSync(filename, "utf8")) : scenario.traces ?? []
  const circuit = convertToCircuitJson(scenario, routes, { originalSrj: scenario, includeOriginalConnections: true })
  compare(`srj18-${sample}${hasRoutedOutput ? "-routed" : "-input"}`, circuit)
}
console.log("Trace contiguity matches frozen TS: full ordered errors and unchanged inputs")
