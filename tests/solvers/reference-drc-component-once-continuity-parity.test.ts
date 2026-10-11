import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap, PcbConnectivityMap } from "circuit-json-to-connectivity-map"
import { getDrcErrors } from "../../lib/testing/getDrcErrors"
import { canUseExpectedPortsMemo } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/canUseExpectedPortsMemo"
import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import { checkViaTraceClearanceWithLazyCenters } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/checkViaTraceClearanceWithLazyCenters"
import { checkTracesAreContiguous, createPrivatelyMemoizedTraceContinuityChecker } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/native/lib/check-traces-are-contiguous/check-traces-are-contiguous"

const wire = (x: number, y: number, layer = "top"): any => ({
  route_type: "wire", x, y, width: 0.1, layer,
})

function connectedTraces(): any[] {
  return [
    { type: "source_trace", source_trace_id: "s", connected_source_port_ids: ["sp0", "sp2"] },
    ...[0, 1, 2].flatMap((i) => [
      { type: "pcb_port", pcb_port_id: `p${i}`, source_port_id: `sp${i}`, pcb_component_id: "c", x: i * 1.5, y: 0, layers: ["top"] },
      { type: "pcb_smtpad", pcb_smtpad_id: `pad${i}`, pcb_port_id: `p${i}`, pcb_component_id: "c", shape: "rect", x: i * 1.5, y: 0, width: 0.4, height: 0.4, layer: "top" },
    ]),
    ...[0, 1, 2].map((i) => ({ type: "pcb_trace", pcb_trace_id: `t${i}`, source_trace_id: "s", route: [wire(i, 0), wire(i + 1, 0)] })),
  ]
}

test("private continuity expands native physical components once with exact native errors and observer fallback", async () => {
  await initializeReferenceDrcRuntime()
  const captures = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL(
    "../fixtures/reference-drc-srj18/sample015-native-reference.json.gz", import.meta.url,
  )))).toString()) as { records: { circuitJson: any[]; options: any; expected: unknown }[] }
  const checker = createPrivatelyMemoizedTraceContinuityChecker()
  expect(captures.records.length).toBe(17)
  for (const capture of captures.records) {
    const circuit = structuredClone(capture.circuitJson)
    expect(canUseExpectedPortsMemo(circuit)).toBe(true)
    const actual = getDrcErrors(circuit, {
      ...capture.options,
      traceContinuityChecker: checker,
      viaTraceChecker: (input, options) => checkViaTraceClearanceWithLazyCenters(input, {
        ...options, enableAxisRejection: true, enableConnectivityMemo: true,
      }),
    })
    expect(JSON.parse(JSON.stringify(actual))).toEqual(capture.expected)
  }

  const fixtures = [connectedTraces()]
  const crossNet = connectedTraces()
  crossNet.push({ type: "source_trace", source_trace_id: "other", connected_source_port_ids: ["sp1"] })
  crossNet.find((element) => element.pcb_trace_id === "t1").source_trace_id = "other"
  fixtures.push(crossNet)
  const duplicate = connectedTraces()
  duplicate.push({ ...duplicate.find((element) => element.pcb_trace_id === "t1"), route: [wire(0.5, 0), wire(2.5, 0)] })
  fixtures.push(duplicate)
  for (const ids of [[1, "1", "t2"], ["__proto__", "constructor", "toString"], ["", false, null]]) {
    const circuit = connectedTraces()
    circuit.filter((element) => element.type === "pcb_trace").forEach((trace, i) => { trace.pcb_trace_id = ids[i] })
    fixtures.push(circuit)
  }
  const sharedPad = connectedTraces().filter((element) => element.type !== "pcb_trace")
  sharedPad.find((element) => element.pcb_smtpad_id === "pad1").width = 2.6
  sharedPad.push(
    { type: "pcb_trace", pcb_trace_id: "a", source_trace_id: "s", route: [wire(0, 0), wire(0.4, 0)] },
    { type: "pcb_trace", pcb_trace_id: "b", source_trace_id: "s", route: [wire(2.6, 0), wire(3, 0)] },
  )
  fixtures.push(sharedPad)
  const via = connectedTraces().filter((element) => element.type !== "pcb_trace")
  via.find((element) => element.pcb_port_id === "p2").layers = ["bottom"]
  via.find((element) => element.pcb_smtpad_id === "pad2").layer = "bottom"
  via.push(
    { type: "pcb_trace", pcb_trace_id: "a", source_trace_id: "s", route: [wire(0, 0), wire(1.5, 0)] },
    { type: "pcb_trace", pcb_trace_id: "b", source_trace_id: "s", route: [wire(1.5, 0, "bottom"), wire(3, 0, "bottom")] },
    { type: "pcb_via", pcb_via_id: "v", pcb_trace_id: "a", x: 1.5, y: 0, outer_diameter: 0.4, hole_diameter: 0.2, layers: ["top", "bottom"] },
  )
  fixtures.push(via)
  const empty = connectedTraces()
  empty.push({ type: "pcb_trace", pcb_trace_id: "empty", source_trace_id: "s", route: [] })
  fixtures.push(empty)
  const floating = connectedTraces().filter((element) => element.type !== "source_trace")
  floating.filter((element) => element.type === "pcb_trace").forEach((trace) => { delete trace.source_trace_id })
  fixtures.push(floating)
  const duplicateSource = connectedTraces()
  duplicateSource.unshift({ type: "source_trace", source_trace_id: "s", connected_source_port_ids: ["sp1"] })
  fixtures.push(duplicateSource)
  expect(fixtures.length).toBe(11)
  for (const fixture of fixtures) {
    const privateChecker = createPrivatelyMemoizedTraceContinuityChecker()
    for (let repeat = 0; repeat < 2; repeat++) {
      const nativeInput = structuredClone(fixture)
      const privateInput = structuredClone(fixture)
      let nativeError: any, privateError: any, nativeOutput: unknown, privateOutput: unknown
      try { nativeOutput = checkTracesAreContiguous(nativeInput) } catch (error) { nativeError = error }
      try { privateOutput = privateChecker(privateInput) } catch (error) { privateError = error }
      if (nativeError || privateError) {
        expect(privateError?.name).toBe(nativeError?.name)
        expect(privateError?.message).toBe(nativeError?.message)
      } else {
        expect(privateOutput).toEqual(nativeOutput)
      }
      expect(nativeInput).toEqual(fixture)
      expect(privateInput).toEqual(fixture)
    }
  }

  for (const method of ["getAllTracesConnectedToTrace", "getNetConnectedToId"]) {
    const target = method === "getAllTracesConnectedToTrace" ? PcbConnectivityMap.prototype : ConnectivityMap.prototype
    const original = Object.getOwnPropertyDescriptor(target, method)!
    let calls = 0, reads = 0
    try {
      Object.defineProperty(target, method, { configurable: true, get() {
        reads++
        return function (this: unknown, ...args: any[]) { calls++; return Reflect.apply(original.value, this, args) }
      } })
      expect(canUseExpectedPortsMemo(connectedTraces())).toBe(false)
      expect({ calls, reads }).toEqual({ calls: 0, reads: 0 })
      const nativeOutput = checkTracesAreContiguous(connectedTraces())
      const nativeCounts = { calls, reads }
      calls = 0; reads = 0
      const privateOutput = createPrivatelyMemoizedTraceContinuityChecker()(connectedTraces())
      expect(privateOutput).toEqual(nativeOutput)
      expect({ calls, reads }).toEqual(nativeCounts)
      expect(nativeCounts).toEqual({ calls: 3, reads: 3 })
    } finally { Object.defineProperty(target, method, original) }
  }
  const sentinel = new RangeError("original observed component query")
  const original = Object.getOwnPropertyDescriptor(PcbConnectivityMap.prototype, "getAllTracesConnectedToTrace")!
  try {
    Object.defineProperty(PcbConnectivityMap.prototype, "getAllTracesConnectedToTrace", { configurable: true, value() { throw sentinel } })
    for (const nativeChecker of [checkTracesAreContiguous, createPrivatelyMemoizedTraceContinuityChecker()]) {
      let thrown: unknown
      try { nativeChecker(connectedTraces()) } catch (error) { thrown = error }
      expect(thrown).toBe(sentinel)
    }
  } finally { Object.defineProperty(PcbConnectivityMap.prototype, "getAllTracesConnectedToTrace", original) }
})
