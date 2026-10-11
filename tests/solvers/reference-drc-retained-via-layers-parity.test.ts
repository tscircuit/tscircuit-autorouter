import { expect, test } from "bun:test"
import { deepStrictEqual, strictEqual } from "node:assert"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { checkViaTraceClearance } from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getDrcErrors, type GetDrcErrorsOptions, type GetDrcErrorsResult } from "../../lib/testing/getDrcErrors"
import { checkViaTraceClearanceWithLazyCenters, type LazyViaTraceCenterDiagnostics } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/checkViaTraceClearanceWithLazyCenters"
import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"

function makeCircuit(layers: unknown): AnyCircuitElement[] {
  return [
    { type: "pcb_via", pcb_via_id: "v", x: 0, y: 0, outer_diameter: 0.2, hole_diameter: 0.1, layers },
    { type: "pcb_trace", pcb_trace_id: "t", route: [-1, -0.5, 0, 1].map((x) => ({
      route_type: "wire", x, y: 0.25, width: 0.1, layer: "top",
    })) },
  ] as AnyCircuitElement[]
}

test("retained plain via layers preserve complete native DRC and per-segment observer boundaries", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  const fixture = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL(
    "../fixtures/reference-drc-srj18/sample015-native-reference.json.gz", import.meta.url,
  )))).toString()) as { records: { circuitJson: AnyCircuitElement[]; options: GetDrcErrorsOptions; expected: GetDrcErrorsResult }[] }
  expect(fixture.records.length).toBe(17)
  for (const capture of fixture.records) {
    const native = getDrcErrors(structuredClone(capture.circuitJson), capture.options)
    const actual = getDrcErrors(structuredClone(capture.circuitJson), {
      ...capture.options,
      viaTraceChecker: (circuit, options): ReturnType<typeof checkViaTraceClearance> =>
        checkViaTraceClearanceWithLazyCenters(circuit, {
          ...options, enableAxisRejection: true, enableConnectivityMemo: true,
        }),
    })
    deepStrictEqual(actual, native)
    deepStrictEqual(JSON.parse(JSON.stringify(actual)), capture.expected)
  }

  const connMap = new ConnectivityMap({ a: ["t"], b: ["v"] })
  for (const layers of [["top"], ["bottom"], ["top", "top"], [], undefined, ["inner1", "top", "bottom"]]) {
    const circuit = makeCircuit(layers)
    const options = { connMap, minClearance: 0.2 }
    deepStrictEqual(checkViaTraceClearanceWithLazyCenters(circuit, {
      ...options, enableAxisRejection: true, enableConnectivityMemo: true,
    }), checkViaTraceClearance(circuit, options))
  }

  const changed = makeCircuit(["top"])
  const changedVia = changed[0] as Extract<AnyCircuitElement, { type: "pcb_via" }>
  let queries = 0
  const diagnostics: LazyViaTraceCenterDiagnostics = {
    eligibleChecks: 0, nativeChecks: 0, gapCalls: 0, centerCalls: 0,
    get connectivityQueries(): number { return queries },
    set connectivityQueries(value: number) { queries = value; changedVia.layers = ["bottom"] },
  }
  checkViaTraceClearanceWithLazyCenters(changed, {
    connMap, minClearance: 0.2, diagnostics, enableConnectivityMemo: true,
  })
  expect(diagnostics.eligibleChecks).toBe(1)
  expect(diagnostics.gapCalls).toBe(1)
  expect(queries).toBe(1)

  const observed = makeCircuit(["top"])
  let reads = 0
  Object.defineProperty(observed[0], "layers", { configurable: true, get(): string[] {
    reads++
    return ["top"]
  } })
  const options = { connMap, minClearance: 0.2 }
  const expected = checkViaTraceClearance(observed, options)
  const nativeReads = reads
  reads = 0
  deepStrictEqual(checkViaTraceClearanceWithLazyCenters(observed, {
    ...options, enableConnectivityMemo: true,
  }), expected)
  expect(reads).toBe(nativeReads)
  expect(reads).toBeGreaterThan(1)

  const failure = new RangeError("native layer observer")
  Object.defineProperty(observed[0], "layers", { configurable: true, get(): never { throw failure } })
  let actualError: unknown
  try { checkViaTraceClearanceWithLazyCenters(observed, options) } catch (error) { actualError = error }
  strictEqual(actualError, failure)
})
