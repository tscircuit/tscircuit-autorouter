import { expect, test } from "bun:test"
import { checkTracesAreContiguous as nativeCheck } from "@tscircuit/checks"
import { Point } from "@flatten-js/core"
import { deepStrictEqual, strictEqual } from "node:assert"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { AnyCircuitElement, PcbPort, SourceTrace } from "circuit-json"
import { PcbConnectivityMap } from "circuit-json-to-connectivity-map"
import Flatbush from "flatbush"
import { getDrcErrors, type GetDrcErrorsOptions, type GetDrcErrorsResult } from "../../lib/testing/getDrcErrors"
import { canUseExpectedPortsMemo } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/canUseExpectedPortsMemo"
import { createExpectedPortsMemo } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/createExpectedPortsMemo"
import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import { ReferenceDrcPrimitiveMemo } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/ReferenceDrcPrimitiveMemo"
import { checkTracesAreContiguous, createPrivatelyMemoizedTraceContinuityChecker } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/native/lib/check-traces-are-contiguous/check-traces-are-contiguous"

type Capture = { circuitJson: AnyCircuitElement[]; options: GetDrcErrorsOptions; expected: GetDrcErrorsResult }
type Element = Record<string, any>

function makeCircuit(): AnyCircuitElement[] {
  const wire = (x: number): Element => ({ route_type: "wire", x, y: 0, width: 0.1, layer: "top" })
  return [
    { type: "source_trace", source_trace_id: "S", connected_source_port_ids: ["s0", "s1", "s1"] },
    // Native .find keeps the first source object when source IDs collide.
    { type: "source_trace", source_trace_id: "S", connected_source_port_ids: ["s2"] },
    ...[0, 1, 2].flatMap((i): Element[] => [
      { type: "pcb_port", pcb_port_id: `p${i}`, source_port_id: `s${i}`, x: i, y: 0, layers: ["top"] },
      { type: "pcb_smtpad", pcb_smtpad_id: `pad${i}`, pcb_port_id: `p${i}`, x: i, y: 0, shape: "rect", width: 0.2, height: 0.2, layer: "top" },
    ]),
    { type: "pcb_trace", pcb_trace_id: "T0", source_trace_id: "S", route: [wire(0), wire(1)] },
    { type: "pcb_trace", pcb_trace_id: "T1", source_trace_id: "S", route: [wire(1), wire(2)] },
  ] as AnyCircuitElement[]
}

test("private per-check expected ports preserve full native reference results, first-source identity, malformed inputs and geometry observers", async (): Promise<void> => {
  const guardModule = new URL("../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/canUseExpectedPortsMemo.ts", import.meta.url)
  const unavailableBrowserGlobal = Bun.spawnSync([process.execPath, "-e", `
    Reflect.deleteProperty(globalThis, "SharedArrayBuffer")
    const guard = await import(${JSON.stringify(guardModule.href)})
    console.log(guard.canUseExpectedPortsMemo([]))
  `])
  expect(unavailableBrowserGlobal.exitCode).toBe(0)
  expect(unavailableBrowserGlobal.stdout.toString().trim()).toBe("false")
  await initializeReferenceDrcRuntime()
  const checker = createPrivatelyMemoizedTraceContinuityChecker()
  const captures = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL("../fixtures/reference-drc-srj18/sample015-native-reference.json.gz", import.meta.url)))).toString()) as { records: Capture[] }
  let sources = 0, hits = 0, entries = 0
  for (const capture of captures.records) {
    expect(canUseExpectedPortsMemo(capture.circuitJson)).toBe(true)
    const native = getDrcErrors(capture.circuitJson, capture.options)
    const actual = getDrcErrors(capture.circuitJson, { ...capture.options, traceContinuityChecker: checker })
    deepStrictEqual(actual, native)
    deepStrictEqual(JSON.parse(JSON.stringify(actual)), capture.expected)
    const ports = capture.circuitJson.filter((element): element is PcbPort => element.type === "pcb_port")
    const sourceTraces = capture.circuitJson.filter((element): element is SourceTrace => element.type === "source_trace")
    const memo = createExpectedPortsMemo(ports)
    for (const trace of capture.circuitJson) {
      if (trace.type !== "pcb_trace" || trace.route.length === 0) continue
      const source = sourceTraces.find((candidate) => candidate.source_trace_id === trace.source_trace_id)
      if (!source) continue
      deepStrictEqual(memo.get(source), ports.filter((port) => source.connected_source_port_ids?.includes(port.source_port_id)))
    }
    sources += memo.diagnostics.sources
    hits += memo.diagnostics.hits
    entries += memo.diagnostics.membershipEntries
  }
  expect(sources).toBe(1_648)
  expect(hits).toBe(5_728)
  expect(entries).toBe(9_056)

  const circuit = makeCircuit()
  deepStrictEqual(checker(circuit), nativeCheck(circuit))
  const source = circuit[0] as SourceTrace
  const firstIds = source.connected_source_port_ids
  for (const ids of [["s2"], ["s0", "s1"], [], undefined, null, "s0;s1", "s2"]) {
    Reflect.set(source, "connected_source_port_ids", ids)
    deepStrictEqual(checker(circuit), nativeCheck(circuit))
  }
  Reflect.set(source, "connected_source_port_ids", firstIds)
  deepStrictEqual(checker(circuit), nativeCheck(circuit))
  const rawIds: unknown[] = [undefined, NaN, -0, "dup", "dup", { id: 1 }]
  const sparseIds = new Array(5)
  sparseIds[2] = "dup"
  const ports = [...rawIds, 0, "missing"].map((id, i) => ({ type: "pcb_port", pcb_port_id: `raw${i}`, source_port_id: id })) as unknown as PcbPort[]
  for (const ids of [rawIds, sparseIds, undefined, null, "raw duplicate"]) {
    const rawSource = { type: "source_trace", source_trace_id: "raw", connected_source_port_ids: ids } as unknown as SourceTrace
    const memo = createExpectedPortsMemo(ports)
    const nativePorts = (): PcbPort[] => ports.filter((port) => rawSource.connected_source_port_ids?.includes(port.source_port_id))
    deepStrictEqual(memo.get(rawSource), nativePorts())
    deepStrictEqual(memo.get(rawSource), nativePorts())
    expect(memo.diagnostics.nativeFilters).toBe(typeof ids === "string" ? 2 : 0)
  }
  Reflect.set(source, "connected_source_port_ids", { malformed: true })
  const throws = (check: (input: AnyCircuitElement[]) => unknown): Error => {
    try { check(circuit) } catch (error) { return error as Error }
    throw new Error("Malformed source IDs did not throw")
  }
  const nativeError = throws(nativeCheck)
  const actualError = throws(checker)
  expect(actualError.constructor).toBe(nativeError.constructor)
  expect(actualError.message).toBe(nativeError.message)
  Reflect.set(source, "connected_source_port_ids", firstIds)

  const originalIncludes = Object.getOwnPropertyDescriptor(Array.prototype, "includes")!
  const includeEvents: string[] = []
  const nativeIncludes = originalIncludes.value as (this: unknown[], value: unknown, fromIndex?: number) => boolean
  Object.defineProperty(Array.prototype, "includes", { ...originalIncludes, value: function(this: unknown[], value: unknown, fromIndex?: number): boolean {
    if (this === firstIds) includeEvents.push(String(value))
    return nativeIncludes.call(this, value, fromIndex)
  } })
  try {
    expect(canUseExpectedPortsMemo(circuit)).toBe(false)
    const expected = nativeCheck(circuit)
    const nativeIncludesEvents = includeEvents.slice()
    includeEvents.length = 0
    deepStrictEqual(checker(circuit), expected)
    deepStrictEqual(includeEvents, nativeIncludesEvents)
    expect(includeEvents).toHaveLength(6)
  } finally { Object.defineProperty(Array.prototype, "includes", originalIncludes) }

  // Eligibility checks descriptors, not a replacement method/getter. The
  // original whole checker still executes observers at its native sites.
  const observers: Array<{ target: object; key: string; replacement: unknown }> = [
    { target: PcbConnectivityMap.prototype, key: "getAllTracesConnectedToTrace", replacement: (): never => { throw new RangeError("map observer") } },
    { target: ReferenceDrcPrimitiveMemo.prototype, key: "intern", replacement: (): never => { throw new RangeError("memo observer") } },
    { target: Point.prototype, key: "transform", replacement: (): never => { throw new RangeError("geometry observer") } },
    { target: Flatbush.prototype, key: "search", replacement: (): never => { throw new RangeError("index observer") } },
  ]
  for (const observer of observers) {
    const descriptor = Object.getOwnPropertyDescriptor(observer.target, observer.key)!
    Object.defineProperty(observer.target, observer.key, { ...descriptor, value: observer.replacement })
    try { expect(canUseExpectedPortsMemo(circuit)).toBe(false) }
    finally { Object.defineProperty(observer.target, observer.key, descriptor) }
  }
  const jsonDescriptor = Object.getOwnPropertyDescriptor(JSON, "stringify")!
  Object.defineProperty(JSON, "stringify", { ...jsonDescriptor, value: (): never => { throw new Error("JSON observer") } })
  try { expect(canUseExpectedPortsMemo(circuit)).toBe(false) }
  finally { Object.defineProperty(JSON, "stringify", jsonDescriptor) }
  for (const name of ["Proxy", "Float64Array", "isNaN"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)!
    let observed = 0
    Object.defineProperty(globalThis, name, { configurable: true, get: (): never => { observed++; throw new Error("constructor observer") } })
    try { expect(canUseExpectedPortsMemo(circuit)).toBe(false); expect(observed).toBe(0) }
    finally { Object.defineProperty(globalThis, name, descriptor) }
  }
  let getterCalls = 0
  const originalTransform = Object.getOwnPropertyDescriptor(Point.prototype, "transform")!
  Object.defineProperty(Point.prototype, "transform", { configurable: true, get: (): never => { getterCalls++; throw new Error("must not read during guard") } })
  try { expect(canUseExpectedPortsMemo(circuit)).toBe(false); expect(getterCalls).toBe(0) }
  finally { Object.defineProperty(Point.prototype, "transform", originalTransform) }

  const failure = new RangeError("source IDs observer")
  const sourceDescriptor = Object.getOwnPropertyDescriptor(source, "connected_source_port_ids")!
  const events: string[] = []
  Object.defineProperty(source, "connected_source_port_ids", { configurable: true, get: (): never => { events.push("source IDs"); throw failure } })
  try {
    expect(canUseExpectedPortsMemo(circuit)).toBe(false)
    expect(events).toHaveLength(0)
    strictEqual(throws(nativeCheck), failure)
    const nativeEvents = events.slice()
    events.length = 0
    strictEqual(throws(checker), failure)
    deepStrictEqual(events, nativeEvents)
  } finally { Object.defineProperty(source, "connected_source_port_ids", sourceDescriptor) }

  // Explicit external memo hooks remain on the former checker path.
  const external = new ReferenceDrcPrimitiveMemo()
  deepStrictEqual(checkTracesAreContiguous(circuit, { primitiveMemo: external }), nativeCheck(circuit))
  const physical = new PcbConnectivityMap(circuit)
  deepStrictEqual(checkTracesAreContiguous(circuit, { pcbConnectivityMap: physical, primitiveMemo: external }), nativeCheck(circuit, { pcbConnectivityMap: physical }))
})
