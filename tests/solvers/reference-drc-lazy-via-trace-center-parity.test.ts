import { expect, test } from "bun:test"
import { deepStrictEqual, strictEqual } from "node:assert"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { checkViaTraceClearance } from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getDrcErrors, type GetDrcErrorsOptions, type GetDrcErrorsResult } from "../../lib/testing/getDrcErrors"
import { checkViaTraceClearanceWithLazyCenters, type LazyViaTraceCenterDiagnostics } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/checkViaTraceClearanceWithLazyCenters"

import { initializeReferenceDrcRuntime, getReferenceDrcProxyInspector } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"

type ReferenceCapture = { circuitJson: AnyCircuitElement[]; options: GetDrcErrorsOptions; expected: GetDrcErrorsResult }

function diagnostics(): LazyViaTraceCenterDiagnostics {
  return { eligibleChecks: 0, nativeChecks: 0, gapCalls: 0, centerCalls: 0 }
}

function makeCircuit(lines: Array<{ id: string; y: number; layer?: string; x2?: number; width?: number }>, viaY = 0): AnyCircuitElement[] {
  return [
    { type: "pcb_via", pcb_via_id: "v", x: 0, y: viaY, outer_diameter: 0.2, hole_diameter: 0.1, layers: ["top", "bottom"] },
    ...lines.map((line) => ({
      type: "pcb_trace", pcb_trace_id: line.id,
      route: [
        { route_type: "wire", x: -1, y: line.y, width: line.width ?? 0.1, layer: line.layer ?? "top" },
        { route_type: "wire", x: line.x2 ?? 1, y: line.y, width: 0.8, layer: line.layer ?? "top" },
      ],
    })),
  ] as AnyCircuitElement[]
}

function compareSmall(circuit: AnyCircuitElement[], count = diagnostics(), connMap = new ConnectivityMap({ netV: ["v"], netA: ["a"], netB: ["b"] })): ReturnType<typeof checkViaTraceClearance> {
  const options = { minClearance: 0.2, connMap }
  const native = checkViaTraceClearance(circuit, options)
  const actual = checkViaTraceClearanceWithLazyCenters(circuit, { ...options, diagnostics: count })
  deepStrictEqual(actual, native)
  if (actual[0] && native[0]) expect(actual[0].center).not.toBe(native[0].center)
  return actual
}

function compareObservers(circuit: AnyCircuitElement[], events: string[], connMap?: ConnectivityMap): void {
  // cju lazily creates its native internal store on first use. Compare the two
  // observed calls with that same native store already materialized.
  try { checkViaTraceClearance(circuit, { connMap, minClearance: 0.2 }) } catch {}
  events.length = 0
  let native: unknown
  let nativeError: unknown
  try { native = checkViaTraceClearance(circuit, { connMap, minClearance: 0.2 }) } catch (error) { nativeError = error }
  const originalEvents = events.slice()
  events.length = 0
  const count = diagnostics()
  let actual: unknown
  let actualError: unknown
  try { actual = checkViaTraceClearanceWithLazyCenters(circuit, { connMap, minClearance: 0.2, diagnostics: count }) } catch (error) { actualError = error }
  strictEqual(actualError, nativeError)
  deepStrictEqual(actual, native)
  deepStrictEqual(events, originalEvents)
  expect(count.nativeChecks).toBe(1)
  expect(count.eligibleChecks).toBe(0)
}

test("lazy via-trace centers retain complete native reference results, overlap order, mutation and observer semantics", async (): Promise<void> => {
  if (getReferenceDrcProxyInspector() === undefined) {
    const beforeInitialization = diagnostics()
    compareSmall(makeCircuit([{ id: "a", y: 0.25 }]), beforeInitialization)
    expect(beforeInitialization.nativeChecks).toBe(1)
    expect(beforeInitialization.gapCalls).toBe(0)
  }
  const runtimeSource = readFileSync(new URL("../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime.ts", import.meta.url), "utf8")
  const unavailableModuleSource = runtimeSource.replace('["node", "util"].join(":")', '"unavailable-browser-reference-runtime"')
  expect(unavailableModuleSource).not.toBe(runtimeSource)
  const browserRuntime = await import(`data:text/javascript;base64,${Buffer.from(new Bun.Transpiler().transformSync(unavailableModuleSource, "ts")).toString("base64")}`) as typeof import("../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime")
  expect(browserRuntime.getReferenceDrcProxyInspector()).toBeUndefined()
  await browserRuntime.initializeReferenceDrcRuntime()
  expect(browserRuntime.getReferenceDrcProxyInspector()).toBeUndefined()
  await initializeReferenceDrcRuntime()
  const fixture = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL("../fixtures/reference-drc-srj18/sample015-native-reference.json.gz", import.meta.url)))).toString()) as { records: ReferenceCapture[] }
  expect(fixture.records).toHaveLength(17)
  const total = diagnostics()
  for (const capture of fixture.records) {
    const native = getDrcErrors(capture.circuitJson, capture.options)
    const actual = getDrcErrors(capture.circuitJson, {
      ...capture.options,
      viaTraceChecker: (circuit, options): ReturnType<typeof checkViaTraceClearance> =>
        checkViaTraceClearanceWithLazyCenters(circuit, { ...options, diagnostics: total }),
    })
    deepStrictEqual(actual, native)
    deepStrictEqual(JSON.parse(JSON.stringify(actual)), capture.expected)
  }
  expect(total.eligibleChecks).toBe(17)
  expect(total.nativeChecks).toBe(0)
  expect(total.gapCalls).toBe(16_606_051)
  expect(total.centerCalls).toBe(466)
  expect(total.centerCalls).toBeGreaterThan(0)

  const duplicateCases = [
    [{ id: "a", y: 0.25 }, { id: "b", y: 0.24 }, { id: "a", y: 0.23 }],
    [{ id: "a", y: 0.25 }, { id: "b", y: 0.24 }, { id: "a", y: 0.01 }, { id: "a", y: 0.22 }],
    [{ id: "a", y: 0.01 }, { id: "a", y: 0.25 }],
    [{ id: "a", y: 0.25 }, { id: "a", y: 0.25 }, { id: "b", y: 0.24, layer: "inner1" }],
    [{ id: "a", y: -0, width: 0 }, { id: "b", y: Number.MIN_VALUE, x2: -1, width: 0 }],
  ]
  for (const lines of duplicateCases) {
    const count = diagnostics()
    compareSmall(makeCircuit(lines), count)
    expect(count.eligibleChecks).toBe(1)
  }
  const farCount = diagnostics()
  expect(compareSmall(makeCircuit([{ id: "a", y: 100 }]), farCount)).toHaveLength(0)
  expect(farCount.gapCalls).toBe(1)
  expect(farCount.centerCalls).toBe(0)
  const simple = makeCircuit([{ id: "a", y: 0.25 }, { id: "b", y: 0.24 }])
  const via = simple[0] as Extract<AnyCircuitElement, { type: "pcb_via" }>
  const trace = simple[1] as Extract<AnyCircuitElement, { type: "pcb_trace" }>
  const point = trace.route[0]!
  if (point.route_type !== "wire") throw new Error("Expected synthetic wire")
  const original = { x: point.x, y: via.y, diameter: via.outer_diameter, width: point.width, layer: point.layer, layers: via.layers }
  const mutations: Array<{ apply: () => void; restore: () => void }> = [
    { apply: (): void => { point.x = 2 }, restore: (): void => { point.x = original.x } },
    { apply: (): void => { via.y = 0.02 }, restore: (): void => { via.y = original.y } },
    { apply: (): void => { via.outer_diameter = 0.4 }, restore: (): void => { via.outer_diameter = original.diameter } },
    { apply: (): void => { point.width = 0.3 }, restore: (): void => { point.width = original.width } },
    { apply: (): void => { point.layer = "bottom" }, restore: (): void => { point.layer = original.layer } },
    { apply: (): void => { via.layers = ["bottom"] }, restore: (): void => { via.layers = original.layers } },
  ]
  for (const mutation of mutations) { mutation.apply(); compareSmall(simple); mutation.restore(); compareSmall(simple) }
  const defaultWidth = makeCircuit([{ id: "a", y: 0.25 }])
  const defaultTrace = defaultWidth[1] as Extract<AnyCircuitElement, { type: "pcb_trace" }>
  for (const routePoint of defaultTrace.route) delete (routePoint as unknown as { width?: number }).width
  compareSmall(defaultWidth)
  const duplicateVia = makeCircuit([{ id: "a", y: 0.25 }])
  duplicateVia.push({ ...(duplicateVia[0] as Extract<AnyCircuitElement, { type: "pcb_via" }>), y: 0.24 })
  compareSmall(duplicateVia)

  const events: string[] = []
  const getterCircuit = makeCircuit([{ id: "a", y: 0.25 }])
  Object.defineProperty(getterCircuit[0], "x", { configurable: true, enumerable: false, get: (): number => { events.push("via-x"); return 0 } })
  compareObservers(getterCircuit, events)
  const thrown = new RangeError("observable via geometry")
  Object.defineProperty(getterCircuit[0], "x", { configurable: true, get: (): never => { events.push("throw"); throw thrown } })
  compareObservers(getterCircuit, events)
  const hiddenCircuit = makeCircuit([{ id: "a", y: 0.25 }])
  Object.defineProperty(hiddenCircuit[0], "unused", { get: (): never => { throw new Error("Eligibility must not invoke hidden getters") } })
  compareObservers(hiddenCircuit, events)
  const customMap = new ConnectivityMap({ netV: ["v"], netA: ["a"], netB: ["b"] })
  const nativeQuery = customMap.areIdsConnected
  customMap.areIdsConnected = function(a: string, b: string): boolean { events.push(`${a}/${b}`); return nativeQuery.call(this, a, b) }
  compareObservers(simple, events, customMap)
  const nativeHypot = Math.hypot
  Math.hypot = (...values: number[]): number => { events.push("hypot"); return nativeHypot(...values) }
  try { compareObservers(simple, events) } finally { Math.hypot = nativeHypot }
  const sqrtDescriptor = Object.getOwnPropertyDescriptor(Math, "sqrt")!
  Object.defineProperty(Math, "sqrt", { configurable: true, get: (): typeof Math.sqrt => { events.push("sqrt-getter"); return sqrtDescriptor.value as typeof Math.sqrt } })
  try { compareObservers(simple, events) } finally { Object.defineProperty(Math, "sqrt", sqrtDescriptor) }
  const finiteDescriptor = Object.getOwnPropertyDescriptor(Number, "isFinite")!
  Object.defineProperty(Number, "isFinite", { configurable: true, get: (): typeof Number.isFinite => { events.push("finite-getter"); return finiteDescriptor.value as typeof Number.isFinite } })
  try { compareObservers(simple, events) } finally { Object.defineProperty(Number, "isFinite", finiteDescriptor) }
  const originalIterator = Array.prototype[Symbol.iterator]
  Array.prototype[Symbol.iterator] = function(): ArrayIterator<unknown> { events.push("iterator"); return originalIterator.call(this) }
  try { compareObservers(simple, events) } finally { Array.prototype[Symbol.iterator] = originalIterator }
  const proxyCases: AnyCircuitElement[][] = []
  proxyCases.push(new Proxy(makeCircuit([{ id: "a", y: 0.25 }]), {
    get(target, property, receiver): unknown { events.push(`root:${String(property)}`); return Reflect.get(target, property, receiver) },
    ownKeys(): never { throw new Error("Eligibility must not invoke Proxy ownKeys") },
  }))
  const nestedProxy = makeCircuit([{ id: "a", y: 0.25 }])
  const proxyTrace = nestedProxy[1] as Extract<AnyCircuitElement, { type: "pcb_trace" }>
  proxyTrace.route[0] = new Proxy(proxyTrace.route[0]!, {
    get(target, property, receiver): unknown { events.push(`point:${String(property)}`); return Reflect.get(target, property, receiver) },
    getOwnPropertyDescriptor(): never { throw new Error("Eligibility must not inspect a Proxy descriptor") },
  })
  proxyCases.push(nestedProxy)
  const layerProxy = makeCircuit([{ id: "a", y: 0.25 }])
  const proxyVia = layerProxy[0] as Extract<AnyCircuitElement, { type: "pcb_via" }>
  proxyVia.layers = new Proxy(proxyVia.layers, {
    get(target, property, receiver): unknown { events.push(`layer:${String(property)}`); return Reflect.get(target, property, receiver) },
    getPrototypeOf(): never { throw new Error("Eligibility must not inspect a Proxy prototype") },
  })
  proxyCases.push(layerProxy)
  for (const proxyCircuit of proxyCases) compareObservers(proxyCircuit, events)
  const proxyMap = new Proxy(new ConnectivityMap({ netV: ["v"], netA: ["a"], netB: ["b"] }), {
    get(target, property, receiver): unknown { events.push(`map:${String(property)}`); return Reflect.get(target, property, receiver) },
    getPrototypeOf(): never { throw new Error("Eligibility must not inspect a Proxy map") },
  })
  compareObservers(simple, events, proxyMap)
  const malformedCircuit = makeCircuit([{ id: "a", y: 0.25 }])
  ;(malformedCircuit[0] as { x: number }).x = Number.NaN
  compareObservers(malformedCircuit, events)

  let invoked = 0
  getDrcErrors(makeCircuit([{ id: "a", y: 0.25 }]), {
    includeTraceContinuity: false, includeTypedTraceClearance: false,
    viaTraceChecker: (): [] => { invoked++; return [] },
  })
  expect(invoked).toBe(0)
})
