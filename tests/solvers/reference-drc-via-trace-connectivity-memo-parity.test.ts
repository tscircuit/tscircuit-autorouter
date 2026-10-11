import { expect, test } from "bun:test"
import { deepStrictEqual, strictEqual } from "node:assert"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { checkViaTraceClearance } from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getDrcErrors, type GetDrcErrorsOptions, type GetDrcErrorsResult } from "../../lib/testing/getDrcErrors"
import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import { checkViaTraceClearanceWithLazyCenters, type LazyViaTraceCenterDiagnostics } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/checkViaTraceClearanceWithLazyCenters"

type ReferenceCapture = { circuitJson: AnyCircuitElement[]; options: GetDrcErrorsOptions; expected: GetDrcErrorsResult }

function makeCircuit(traceIds: string[], viaIds: string[]): AnyCircuitElement[] {
  return [
    ...viaIds.map((id, index) => ({ type: "pcb_via", pcb_via_id: id, x: 0, y: index * 0.01, outer_diameter: 0.2, hole_diameter: 0.1, layers: ["top"] })),
    ...traceIds.map((id) => ({ type: "pcb_trace", pcb_trace_id: id, route: [
      { route_type: "wire", x: -1, y: 0.25, width: 0.1, layer: "top" },
      { route_type: "wire", x: -0.5, y: 0.25, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0, y: 0.25, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0.25, width: 0.1, layer: "top" },
    ] })),
  ] as AnyCircuitElement[]
}

function compareNative(circuit: AnyCircuitElement[], connMap: ConnectivityMap): LazyViaTraceCenterDiagnostics {
  const count: LazyViaTraceCenterDiagnostics = { eligibleChecks: 0, nativeChecks: 0, gapCalls: 0, centerCalls: 0, connectivityQueries: 0, connectivityHits: 0 }
  const options = { connMap, minClearance: 0.2 }
  const native = checkViaTraceClearance(circuit, options)
  const actual = checkViaTraceClearanceWithLazyCenters(circuit, { ...options, diagnostics: count, enableAxisRejection: true, enableConnectivityMemo: true })
  deepStrictEqual(actual, native)
  return count
}

function compareThrown(circuit: AnyCircuitElement[], connMap: ConnectivityMap): void {
  let nativeError: unknown
  let actualError: unknown
  try { checkViaTraceClearance(circuit, { connMap, minClearance: 0.2 }) } catch (error) { nativeError = error }
  try { checkViaTraceClearanceWithLazyCenters(circuit, { connMap, minClearance: 0.2, enableConnectivityMemo: true }) } catch (error) { actualError = error }
  expect(nativeError).toBeInstanceOf(Error)
  expect(actualError).toBeInstanceOf(Error)
  expect((actualError as Error).constructor).toBe((nativeError as Error).constructor)
  expect((actualError as Error).message).toBe((nativeError as Error).message)
}

test("per-invocation native connectivity decisions preserve complete DRC, ID equality, mutations and observable queries", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  const fixture = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL("../fixtures/reference-drc-srj18/sample015-native-reference.json.gz", import.meta.url)))).toString()) as { records: ReferenceCapture[] }
  const count: LazyViaTraceCenterDiagnostics = { eligibleChecks: 0, nativeChecks: 0, gapCalls: 0, centerCalls: 0, axisRejected: 0, connectivityQueries: 0, connectivityHits: 0 }
  for (const capture of fixture.records) {
    const native = getDrcErrors(capture.circuitJson, capture.options)
    const actual = getDrcErrors(capture.circuitJson, {
      ...capture.options,
      viaTraceChecker: (circuit, options): ReturnType<typeof checkViaTraceClearance> =>
        checkViaTraceClearanceWithLazyCenters(circuit, { ...options, diagnostics: count, enableAxisRejection: true, enableConnectivityMemo: true }),
    })
    deepStrictEqual(actual, native)
    deepStrictEqual(JSON.parse(JSON.stringify(actual)), capture.expected)
  }
  expect(count.eligibleChecks).toBe(17)
  expect(count.nativeChecks).toBe(0)
  expect(count.gapCalls).toBe(11_640)
  expect(count.axisRejected).toBe(16_594_411)
  expect(count.centerCalls).toBe(466)
  expect(count.connectivityQueries! + count.connectivityHits!).toBe(23_731_201)
  expect(count.connectivityQueries).toBeLessThan(4_000_000)
  expect(count.connectivityHits).toBeGreaterThan(19_000_000)

  const ordinary = new ConnectivityMap({ netA: ["t"], netV: ["v"] })
  const repeated = makeCircuit(["t", "t", "t"], ["v", "v"])
  const repeatedCount = compareNative(repeated, ordinary)
  expect(repeatedCount.connectivityQueries).toBe(1)
  expect(repeatedCount.connectivityHits).toBe(17)
  ordinary.idToNetMap.t = "netV"
  const joinedCount = compareNative(repeated, ordinary)
  expect(joinedCount.gapCalls).toBe(0)
  expect(joinedCount.connectivityQueries).toBe(1)
  ordinary.idToNetMap.t = "netA"
  expect(compareNative(repeated, ordinary).gapCalls).toBeGreaterThan(0)
  const collisionMap = new ConnectivityMap({ x: ["a_b", "v"], y: ["a"], z: ["b", "v_a"] })
  compareNative(makeCircuit(["a_b", "b", "a"], ["v", "v_a"]), collisionMap)
  // Preserve the original duplicate netId2===id1 term. Do not add the missing
  // opposite alias term as a supposed correction to the native policy.
  const aliasMap = new ConnectivityMap({ netA: ["t"], other: ["netA"] })
  expect(aliasMap.areIdsConnected("t", "netA")).toBe(false)
  compareNative(makeCircuit(["t"], ["netA"]), aliasMap)
  const specialMap = new ConnectivityMap({})
  for (const ids of [["constructor", "__proto__", "", "toString"], ["same", "same"], ["missing", "other-missing"]]) {
    compareNative(makeCircuit(ids, ids), specialMap)
  }
  const nullPrototypeMap = new ConnectivityMap(Object.create(null) as Record<string, string[]>)
  nullPrototypeMap.idToNetMap = Object.create(null) as Record<string, string>
  nullPrototypeMap.idToNetMap.__proto__ = "joined"
  Reflect.set(nullPrototypeMap.idToNetMap, "constructor", "joined")
  compareNative(makeCircuit(["constructor", "__proto__"], ["constructor", "__proto__"]), nullPrototypeMap)
  for (const value of [undefined, null, "", false, 0]) {
    Reflect.set(ordinary.idToNetMap, "t", value)
    compareNative(repeated, ordinary)
  }
  const malformedMap = new ConnectivityMap({})
  Reflect.set(malformedMap, "idToNetMap", null)
  compareThrown(makeCircuit(["t"], ["v"]), malformedMap)
  // Equal IDs return before accessing the malformed graph, just as natively.
  expect(compareNative(makeCircuit(["same"], ["same"]), malformedMap).connectivityQueries).toBe(1)
  const noLayer = makeCircuit(["t"], ["v"])
  ;(noLayer[0] as Extract<AnyCircuitElement, { type: "pcb_via" }>).layers = []
  expect(compareNative(noLayer, malformedMap).connectivityQueries).toBe(0)

  const events: string[] = []
  const observedMap = new ConnectivityMap({ netA: ["t"], netV: ["v"] })
  const nativeQuery = observedMap.areIdsConnected
  observedMap.areIdsConnected = function(a: string, b: string): boolean {
    events.push(`${a}/${b}`)
    const result = nativeQuery.call(this, a, b)
    this.idToNetMap.t = "netV"
    return result
  }
  const options = { connMap: observedMap, minClearance: 0.2 }
  observedMap.idToNetMap.t = "netA"
  const native = checkViaTraceClearance(repeated, options)
  const nativeEvents = events.slice()
  events.length = 0
  observedMap.idToNetMap.t = "netA"
  const observerCount: LazyViaTraceCenterDiagnostics = { eligibleChecks: 0, nativeChecks: 0, gapCalls: 0, centerCalls: 0 }
  deepStrictEqual(checkViaTraceClearanceWithLazyCenters(repeated, { ...options, enableConnectivityMemo: true, diagnostics: observerCount }), native)
  deepStrictEqual(events, nativeEvents)
  expect(observerCount.nativeChecks).toBe(1)
  expect(events).toHaveLength(18)
  const failure = new RangeError("original connectivity observer")
  observedMap.areIdsConnected = (): never => { throw failure }
  let actualError: unknown
  try { checkViaTraceClearanceWithLazyCenters(repeated, { ...options, enableConnectivityMemo: true }) } catch (error) { actualError = error }
  strictEqual(actualError, failure)
})
